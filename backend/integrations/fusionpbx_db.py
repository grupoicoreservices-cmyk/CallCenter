"""FusionPBX direct PostgreSQL connector - simpler and more robust than REST.

No PHP scripts, no Nginx rewrites, no API installations needed.
Just a read-only PostgreSQL user accessing the FusionPBX database directly.
"""
from __future__ import annotations
import logging
from typing import Optional, Dict, Any, List
import asyncpg

logger = logging.getLogger(__name__)


class FusionPBXDBError(Exception):
    pass


class FusionPBXDBClient:
    """Direct PostgreSQL connector for FusionPBX."""

    def __init__(self, host: str, port: int = 5432, database: str = "fusionpbx",
                 username: str = "voxyra_ro", password: str = "",
                 domain_uuid: Optional[str] = None, ssl: bool = False):
        if not host:
            raise FusionPBXDBError("Host PostgreSQL não configurado")
        self.host = host
        self.port = int(port or 5432)
        self.database = database or "fusionpbx"
        self.username = username
        self.password = password or ""
        self.domain_uuid = domain_uuid
        self.ssl = ssl

    async def _connect(self):
        try:
            return await asyncpg.connect(
                host=self.host, port=self.port, user=self.username,
                password=self.password, database=self.database,
                ssl="require" if self.ssl else False, timeout=10,
                command_timeout=30,
            )
        except Exception as e:
            # asyncpg às vezes retorna exceção sem mensagem (ex.: TimeoutError).
            # Inclui tipo + repr para o usuário enxergar a causa real.
            etype = type(e).__name__
            msg = str(e) or repr(e)
            target = f"{self.username}@{self.host}:{self.port}/{self.database}"
            raise FusionPBXDBError(
                f"Falha PostgreSQL [{etype}] em {target}: {msg}"
            ) from e

    async def ping(self) -> Dict[str, Any]:
        conn = await self._connect()
        try:
            v = await conn.fetchval("SELECT version()")
            domains = await conn.fetch("SELECT domain_uuid::text, domain_name FROM v_domains LIMIT 50")
            return {"ok": True, "version": v, "domains": [dict(d) for d in domains]}
        finally:
            await conn.close()

    async def list_extensions(self) -> List[Dict[str, Any]]:
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        conn = await self._connect()
        try:
            rows = await conn.fetch(
                """SELECT extension_uuid::text, extension, effective_caller_id_name,
                          description, mwi_account, COALESCE(enabled,'true') AS enabled
                   FROM v_extensions
                   WHERE domain_uuid = $1::uuid AND COALESCE(enabled,'true') = 'true'
                   ORDER BY extension::int NULLS LAST""",
                self.domain_uuid,
            )
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    async def list_call_center_queues(self) -> List[Dict[str, Any]]:
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        conn = await self._connect()
        try:
            # Verifica se tabela call_center existe
            tbl = await conn.fetchval(
                "SELECT to_regclass('public.v_call_center_queues')::text"
            )
            if tbl:
                col_rows = await conn.fetch(
                    """SELECT column_name FROM information_schema.columns
                       WHERE table_name = 'v_call_center_queues'"""
                )
                cols = {r["column_name"] for r in col_rows}
                pieces = ["call_center_queue_uuid::text AS call_center_queue_uuid"]
                for c, default in [
                    ("queue_name", "NULL"),
                    ("queue_extension", "NULL"),
                    ("queue_strategy", "NULL"),
                    ("queue_max_wait_time", "120"),
                ]:
                    pieces.append(f"{c}" if c in cols else f"{default}::text AS {c}")
                sql = (f"SELECT {', '.join(pieces)} FROM v_call_center_queues "
                       f"WHERE domain_uuid = $1::uuid")
                rows = await conn.fetch(sql, self.domain_uuid)
                return [dict(r) for r in rows]
            # Fallback: ring_groups
            rows = await conn.fetch(
                """SELECT ring_group_uuid::text AS call_center_queue_uuid,
                          ring_group_name AS queue_name,
                          ring_group_extension AS queue_extension,
                          ring_group_strategy AS queue_strategy,
                          60 AS queue_max_wait_time
                   FROM v_ring_groups
                   WHERE domain_uuid = $1::uuid AND ring_group_enabled = 'true'
                   ORDER BY ring_group_extension""",
                self.domain_uuid,
            )
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    async def list_call_center_agents(self) -> List[Dict[str, Any]]:
        if not self.domain_uuid:
            return []
        conn = await self._connect()
        try:
            # Descobre quais colunas existem (varia entre versões do FusionPBX)
            try:
                col_rows = await conn.fetch(
                    """SELECT column_name FROM information_schema.columns
                       WHERE table_name = 'v_call_center_agents'"""
                )
            except Exception:
                return []
            cols = {r["column_name"] for r in col_rows}
            if not cols or "call_center_agent_uuid" not in cols:
                return []
            wanted = [
                "call_center_agent_uuid", "agent_name", "agent_id",
                "agent_status", "agent_state", "agent_contact",
                "agent_type", "agent_call_timeout", "agent_no_answer_delay_time",
            ]
            select_cols = []
            for c in wanted:
                if c == "call_center_agent_uuid":
                    select_cols.append("a.call_center_agent_uuid::text AS call_center_agent_uuid")
                elif c in cols:
                    select_cols.append(f"a.{c}")
                else:
                    select_cols.append(f"NULL::text AS {c}")
            sql = f"""SELECT {', '.join(select_cols)},
                            (regexp_match(COALESCE(a.agent_contact,''), 'user[/=]([0-9]+)'))[1] AS extension_from_contact
                     FROM v_call_center_agents a
                     WHERE a.domain_uuid = $1::uuid
                     ORDER BY a.agent_name"""
            rows = await conn.fetch(sql, self.domain_uuid)
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    async def list_cdr(self, limit: int = 200, start_date: Optional[str] = None,
                       end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        conn = await self._connect()
        try:
            sql = """SELECT xml_cdr_uuid::text, direction,
                            caller_id_number, caller_id_name, destination_number,
                            to_char(start_stamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00' AS start_stamp,
                            to_char(end_stamp   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00' AS end_stamp,
                            duration, billsec, hangup_cause,
                            cc_queue, cc_agent, record_name
                     FROM v_xml_cdr
                     WHERE domain_uuid = $1::uuid"""
            args = [self.domain_uuid]
            if start_date:
                sql += f" AND start_stamp >= ${len(args)+1}"
                args.append(start_date)
            if end_date:
                sql += f" AND start_stamp <= ${len(args)+1}"
                args.append(end_date)
            sql += f" ORDER BY start_stamp DESC LIMIT ${len(args)+1}"
            args.append(int(limit))
            rows = await conn.fetch(sql, *args)
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    async def list_active_calls(self) -> List[Dict[str, Any]]:
        if not self.domain_uuid:
            return []
        conn = await self._connect()
        try:
            try:
                rows = await conn.fetch(
                    """SELECT call_uuid::text AS uuid, direction,
                              caller_id_number, caller_id_name, destination_number,
                              hostname, channel_state, answer_state,
                              created_epoch
                       FROM v_channels
                       WHERE domain_uuid = $1::uuid""",
                    self.domain_uuid,
                )
                return [dict(r) for r in rows]
            except asyncpg.UndefinedTableError:
                return []
        finally:
            await conn.close()

    async def get_recording_url(self, recording_uuid_or_name: str) -> str:
        """Sem REST/HTTP a recording do FusionPBX só pode ser acessada via filesystem.
        Retornamos um identificador local — o frontend faz download via endpoint
        autenticado do Voxyra que pode buscar no PBX por SCP/SFTP futuramente.
        Por ora, salvamos a referência (record_name) que aparece no v_xml_cdr."""
        return f"fusionpbx://{recording_uuid_or_name}"


    # ──────────────────────────────────────────────────────────────────────
    # PROVISIONING (write operations) — requer GRANT INSERT/UPDATE no PG
    # ──────────────────────────────────────────────────────────────────────

    async def provision_queue(self, name: str, extension: str,
                              strategy: str = "ring-all",
                              max_wait_time: int = 120,
                              moh_sound: str = "$${hold_music}",
                              tier_rules_apply: str = "false",
                              record_template: str = "") -> Dict[str, Any]:
        """Cria uma fila no FusionPBX (v_call_center_queues)."""
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        import uuid as _uuid
        new_uuid = str(_uuid.uuid4())
        conn = await self._connect()
        try:
            # checa duplicata
            dup = await conn.fetchval(
                """SELECT call_center_queue_uuid FROM v_call_center_queues
                   WHERE domain_uuid = $1::uuid AND queue_extension = $2""",
                self.domain_uuid, str(extension),
            )
            if dup:
                raise FusionPBXDBError(f"Fila com ramal {extension} já existe")
            await conn.execute(
                """INSERT INTO v_call_center_queues
                   (call_center_queue_uuid, domain_uuid, queue_name, queue_extension,
                    queue_strategy, queue_max_wait_time, queue_moh_sound,
                    queue_tier_rules_apply, queue_record_template, queue_announce_frequency,
                    queue_record_template_call, insert_date, insert_user)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, 0, '', NOW(), $10::uuid)""",
                new_uuid, self.domain_uuid, name, str(extension),
                strategy, int(max_wait_time), moh_sound,
                tier_rules_apply, record_template, new_uuid,
            )
            return {"call_center_queue_uuid": new_uuid, "queue_name": name,
                    "queue_extension": str(extension), "queue_strategy": strategy}
        except FusionPBXDBError:
            raise
        except Exception as e:
            raise FusionPBXDBError(f"Falha ao criar fila [{type(e).__name__}]: {e}") from e
        finally:
            await conn.close()

    async def provision_extension(self, extension: str, sip_password: str,
                                  caller_id_name: str, caller_id_number: str = "",
                                  voicemail_password: Optional[str] = None,
                                  description: str = "") -> Dict[str, Any]:
        """Cria um ramal SIP (v_extensions). Senha SIP em texto puro (FusionPBX usa internamente)."""
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        import uuid as _uuid
        new_uuid = str(_uuid.uuid4())
        conn = await self._connect()
        try:
            dup = await conn.fetchval(
                """SELECT extension_uuid FROM v_extensions
                   WHERE domain_uuid = $1::uuid AND extension = $2""",
                self.domain_uuid, str(extension),
            )
            if dup:
                raise FusionPBXDBError(f"Ramal {extension} já existe neste domínio")
            await conn.execute(
                """INSERT INTO v_extensions
                   (extension_uuid, domain_uuid, extension, password,
                    effective_caller_id_name, effective_caller_id_number,
                    outbound_caller_id_name, outbound_caller_id_number,
                    voicemail_password, voicemail_enabled, enabled, description,
                    insert_date, insert_user)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $5, $6, $7,
                           'true', 'true', $8, NOW(), $1::uuid)""",
                new_uuid, self.domain_uuid, str(extension), sip_password,
                caller_id_name, caller_id_number or str(extension),
                voicemail_password or str(extension), description,
            )
            return {"extension_uuid": new_uuid, "extension": str(extension),
                    "caller_id_name": caller_id_name}
        except FusionPBXDBError:
            raise
        except Exception as e:
            raise FusionPBXDBError(f"Falha ao criar ramal [{type(e).__name__}]: {e}") from e
        finally:
            await conn.close()

    async def provision_user(self, username: str, password_hash: str,
                             contact: str = "") -> Dict[str, Any]:
        """Cria um usuário (login) no FusionPBX (v_users).
        password_hash: já pré-hashed em md5(salt:user:pass) ou bcrypt — depende da versão.
        Para FusionPBX padrão, usamos md5(username + ':' + password_salt + ':' + password)."""
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        import uuid as _uuid
        new_uuid = str(_uuid.uuid4())
        conn = await self._connect()
        try:
            dup = await conn.fetchval(
                """SELECT user_uuid FROM v_users
                   WHERE domain_uuid = $1::uuid AND username = $2""",
                self.domain_uuid, username,
            )
            if dup:
                raise FusionPBXDBError(f"Usuário '{username}' já existe neste domínio")
            await conn.execute(
                """INSERT INTO v_users
                   (user_uuid, domain_uuid, username, password, user_status, user_enabled,
                    contact_uuid, insert_date, insert_user)
                   VALUES ($1::uuid, $2::uuid, $3, $4, 'Available', 'true',
                           NULLIF($5,'')::uuid, NOW(), $1::uuid)""",
                new_uuid, self.domain_uuid, username, password_hash, contact,
            )
            return {"user_uuid": new_uuid, "username": username}
        except FusionPBXDBError:
            raise
        except Exception as e:
            raise FusionPBXDBError(f"Falha ao criar usuário [{type(e).__name__}]: {e}") from e
        finally:
            await conn.close()

    async def provision_call_center_agent(self, agent_name: str, agent_id: str,
                                          extension: str,
                                          agent_type: str = "callback",
                                          call_timeout: int = 20,
                                          no_answer_delay_time: int = 10,
                                          domain_name: Optional[str] = None) -> Dict[str, Any]:
        """Cria um agente do Call Center vinculado a um ramal."""
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        import uuid as _uuid
        new_uuid = str(_uuid.uuid4())
        # FusionPBX espera contact no formato "[leg_timeout=X]user/EXT@DOMAIN"
        if domain_name:
            contact = f"[leg_timeout={call_timeout}]user/{extension}@{domain_name}"
        else:
            contact = f"[leg_timeout={call_timeout}]user/{extension}"
        conn = await self._connect()
        try:
            dup = await conn.fetchval(
                """SELECT call_center_agent_uuid FROM v_call_center_agents
                   WHERE domain_uuid = $1::uuid AND agent_id = $2""",
                self.domain_uuid, agent_id,
            )
            if dup:
                raise FusionPBXDBError(f"Agente '{agent_id}' já existe neste domínio")
            # Descobre colunas existentes (algumas versões variam)
            col_rows = await conn.fetch(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_name = 'v_call_center_agents'"""
            )
            cols = {r["column_name"] for r in col_rows}
            base_cols = ["call_center_agent_uuid", "domain_uuid", "agent_name",
                         "agent_id", "agent_type", "agent_contact"]
            base_vals = [new_uuid, self.domain_uuid, agent_name,
                         agent_id, agent_type, contact]
            optional = [
                ("agent_status", "Available"),
                ("agent_call_timeout", call_timeout),
                ("agent_no_answer_delay_time", no_answer_delay_time),
                ("agent_max_no_answer", 0),
                ("agent_wrap_up_time", 10),
                ("agent_reject_delay_time", 0),
                ("agent_busy_delay_time", 0),
            ]
            for c, v in optional:
                if c in cols:
                    base_cols.append(c); base_vals.append(v)
            placeholders = []
            for i, c in enumerate(base_cols, start=1):
                if c == "call_center_agent_uuid":
                    placeholders.append(f"${i}::uuid")
                elif c == "domain_uuid":
                    placeholders.append(f"${i}::uuid")
                else:
                    placeholders.append(f"${i}")
            sql = (f"INSERT INTO v_call_center_agents ({', '.join(base_cols)}) "
                   f"VALUES ({', '.join(placeholders)})")
            await conn.execute(sql, *base_vals)
            return {"call_center_agent_uuid": new_uuid, "agent_name": agent_name,
                    "agent_id": agent_id, "agent_contact": contact}
        except FusionPBXDBError:
            raise
        except Exception as e:
            raise FusionPBXDBError(f"Falha ao criar agente [{type(e).__name__}]: {e}") from e
        finally:
            await conn.close()

    async def link_extension_to_user(self, extension_uuid: str, user_uuid: str) -> None:
        """Vincula um extension a um user via v_extension_users."""
        import uuid as _uuid
        new_uuid = str(_uuid.uuid4())
        conn = await self._connect()
        try:
            tbl = await conn.fetchval(
                "SELECT to_regclass('public.v_extension_users')::text"
            )
            if not tbl:
                return  # tabela não existe nesta versão
            dup = await conn.fetchval(
                """SELECT extension_user_uuid FROM v_extension_users
                   WHERE extension_uuid = $1::uuid AND user_uuid = $2::uuid""",
                extension_uuid, user_uuid,
            )
            if dup:
                return
            await conn.execute(
                """INSERT INTO v_extension_users
                   (extension_user_uuid, domain_uuid, extension_uuid, user_uuid, insert_date)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW())""",
                new_uuid, self.domain_uuid, extension_uuid, user_uuid,
            )
        except Exception as e:
            logger.warning("Falha ao linkar extension/user: %s", e)
        finally:
            await conn.close()

    async def assign_agent_to_queue(self, agent_uuid: str, queue_uuid: str,
                                    tier_level: int = 1, tier_position: int = 1) -> None:
        """Adiciona um agente a uma fila via v_call_center_tiers."""
        import uuid as _uuid
        new_uuid = str(_uuid.uuid4())
        conn = await self._connect()
        try:
            tbl = await conn.fetchval(
                "SELECT to_regclass('public.v_call_center_tiers')::text"
            )
            if not tbl:
                return
            dup = await conn.fetchval(
                """SELECT call_center_tier_uuid FROM v_call_center_tiers
                   WHERE call_center_queue_uuid = $1::uuid
                     AND call_center_agent_uuid = $2::uuid""",
                queue_uuid, agent_uuid,
            )
            if dup:
                return
            await conn.execute(
                """INSERT INTO v_call_center_tiers
                   (call_center_tier_uuid, domain_uuid, call_center_queue_uuid,
                    call_center_agent_uuid, tier_level, tier_position, insert_date)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, NOW())""",
                new_uuid, self.domain_uuid, queue_uuid, agent_uuid,
                int(tier_level), int(tier_position),
            )
        except Exception as e:
            logger.warning("Falha ao adicionar agente à fila: %s", e)
        finally:
            await conn.close()

    async def delete_queue(self, queue_uuid: str) -> None:
        conn = await self._connect()
        try:
            await conn.execute(
                "DELETE FROM v_call_center_queues WHERE call_center_queue_uuid = $1::uuid AND domain_uuid = $2::uuid",
                queue_uuid, self.domain_uuid,
            )
        finally:
            await conn.close()

    async def delete_extension(self, extension_uuid: str) -> None:
        conn = await self._connect()
        try:
            await conn.execute(
                "DELETE FROM v_extensions WHERE extension_uuid = $1::uuid AND domain_uuid = $2::uuid",
                extension_uuid, self.domain_uuid,
            )
        finally:
            await conn.close()

    async def delete_call_center_agent(self, agent_uuid: str) -> None:
        conn = await self._connect()
        try:
            await conn.execute(
                "DELETE FROM v_call_center_agents WHERE call_center_agent_uuid = $1::uuid AND domain_uuid = $2::uuid",
                agent_uuid, self.domain_uuid,
            )
        finally:
            await conn.close()
