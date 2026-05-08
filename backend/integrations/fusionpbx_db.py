"""FusionPBX direct PostgreSQL connector - simpler and more robust than REST.

No PHP scripts, no Nginx rewrites, no API installations needed.
Just a read-only PostgreSQL user accessing the FusionPBX database directly.
"""
from __future__ import annotations
import logging
from typing import Optional, Dict, Any, List, Tuple
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
        """Cria um ramal SIP (v_extensions). Auto-detecta as colunas presentes
        para compatibilidade entre versões do FusionPBX."""
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
            cols_rows = await conn.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='v_extensions'"
            )
            cols = {r["column_name"] for r in cols_rows}
            # Build column/value pairs only for columns that exist.
            field_map: List[Tuple[str, Any]] = [
                ("extension_uuid", new_uuid),
                ("domain_uuid", self.domain_uuid),
                ("extension", str(extension)),
                ("password", sip_password),
                ("effective_caller_id_name", caller_id_name),
                ("effective_caller_id_number", caller_id_number or str(extension)),
                ("outbound_caller_id_name", caller_id_name),
                ("outbound_caller_id_number", caller_id_number or str(extension)),
                ("voicemail_password", voicemail_password or str(extension)),
                ("voicemail_enabled", "true"),
                ("enabled", "true"),
                ("description", description),
                ("insert_user", new_uuid),
            ]
            present = [(c, v) for (c, v) in field_map if c in cols]
            placeholders = []
            values = []
            cast_cols = {"extension_uuid", "domain_uuid", "insert_user"}
            for i, (c, v) in enumerate(present, start=1):
                ph = f"${i}::uuid" if c in cast_cols else f"${i}"
                placeholders.append(ph)
                values.append(v)
            cols_sql = ", ".join(c for c, _ in present)
            extras = []
            if "insert_date" in cols:
                cols_sql += ", insert_date"
                placeholders.append("NOW()")
            sql = (
                f"INSERT INTO v_extensions ({cols_sql}) "
                f"VALUES ({', '.join(placeholders)})"
            )
            await conn.execute(sql, *values)
            return {"extension_uuid": new_uuid, "extension": str(extension),
                    "caller_id_name": caller_id_name}
        except FusionPBXDBError:
            raise
        except Exception as e:
            raise FusionPBXDBError(f"Falha ao criar ramal [{type(e).__name__}]: {e}") from e
        finally:
            await conn.close()

    async def update_extension_password(self, domain_uuid: str, extension: str,
                                        new_password: str) -> bool:
        """Update the SIP password of an extension."""
        if not domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        conn = await self._connect()
        try:
            res = await conn.execute(
                """UPDATE v_extensions
                   SET password = $1
                   WHERE domain_uuid = $2::uuid AND extension = $3""",
                new_password, domain_uuid, str(extension),
            )
            return "1" in res.split()[-1] if res.split() else False
        except Exception as e:
            raise FusionPBXDBError(f"Falha update_extension_password [{type(e).__name__}]: {e}") from e
        finally:
            await conn.close()

    async def list_extensions(self) -> List[Dict[str, Any]]:
        """Lista ramais (v_extensions) do domínio configurado."""
        if not self.domain_uuid:
            return []
        conn = await self._connect()
        try:
            rows = await conn.fetch(
                """SELECT extension_uuid::text AS uuid,
                          extension,
                          number_alias,
                          effective_caller_id_name AS caller_id_name,
                          effective_caller_id_number AS caller_id_number,
                          enabled,
                          description,
                          user_context
                   FROM v_extensions
                   WHERE domain_uuid = $1::uuid
                   ORDER BY extension::int""",
                self.domain_uuid,
            )
            return [dict(r) for r in rows]
        except Exception as e:
            raise FusionPBXDBError(f"Falha list_extensions [{type(e).__name__}]: {e}") from e
        finally:
            await conn.close()

    async def get_extension_registrations(self, ext_list: List[str]) -> Dict[str, bool]:
        """Verifica se ramais estão registrados via tabela registrations
        (FusionPBX mantém em sip_registrations / v_extensions com registered)."""
        # Implementação simples: marca todos como False (não temos acesso à tabela
        # de registros via PostgreSQL — registros são em memória do FreeSWITCH).
        # O endpoint dedicado usa ESL para checar status real.
        return {ext: False for ext in ext_list}

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

    async def remove_agent_from_queue(self, agent_uuid: str, queue_uuid: str) -> bool:
        """Remove a tier (agente↔fila) de v_call_center_tiers."""
        conn = await self._connect()
        try:
            tbl = await conn.fetchval(
                "SELECT to_regclass('public.v_call_center_tiers')::text"
            )
            if not tbl:
                return False
            res = await conn.execute(
                """DELETE FROM v_call_center_tiers
                   WHERE call_center_queue_uuid = $1::uuid
                     AND call_center_agent_uuid = $2::uuid
                     AND domain_uuid = $3::uuid""",
                queue_uuid, agent_uuid, self.domain_uuid,
            )
            return res.endswith("1") or res.split()[-1].isdigit() and int(res.split()[-1]) > 0
        except Exception as e:
            raise FusionPBXDBError(
                f"Falha remove_agent_from_queue [{type(e).__name__}]: {e}"
            ) from e
        finally:
            await conn.close()

    async def remove_all_tiers_for_agent(self, agent_uuid: str) -> int:
        """Remove TODOS os tiers (vínculos a filas) do agente. Retorna o número
        de linhas removidas. Usado no login do agente para deslogar de tudo
        antes de logar somente nas filas escolhidas."""
        conn = await self._connect()
        try:
            tbl = await conn.fetchval(
                "SELECT to_regclass('public.v_call_center_tiers')::text"
            )
            if not tbl:
                return 0
            res = await conn.execute(
                """DELETE FROM v_call_center_tiers
                   WHERE call_center_agent_uuid = $1::uuid
                     AND domain_uuid = $2::uuid""",
                agent_uuid, self.domain_uuid,
            )
            try:
                return int(res.split()[-1])
            except Exception:
                return 0
        except Exception as e:
            raise FusionPBXDBError(
                f"Falha remove_all_tiers_for_agent [{type(e).__name__}]: {e}"
            ) from e
        finally:
            await conn.close()

    async def list_agent_tiers(self, agent_uuid: str) -> List[Dict[str, Any]]:
        """Lista os tiers (queues) onde o agente está vinculado no PBX."""
        conn = await self._connect()
        try:
            tbl = await conn.fetchval(
                "SELECT to_regclass('public.v_call_center_tiers')::text"
            )
            if not tbl:
                return []
            rows = await conn.fetch(
                """SELECT t.call_center_queue_uuid::text AS queue_uuid,
                          q.queue_name, q.queue_extension,
                          t.tier_level, t.tier_position
                   FROM v_call_center_tiers t
                   JOIN v_call_center_queues q
                     ON q.call_center_queue_uuid = t.call_center_queue_uuid
                   WHERE t.call_center_agent_uuid = $1::uuid
                     AND t.domain_uuid = $2::uuid""",
                agent_uuid, self.domain_uuid,
            )
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    async def update_agent_status(self, agent_uuid: str, status: str) -> None:
        """Update agent status in v_call_center_agents.
        Different FusionPBX versions use different column names: agent_status / state / status."""
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        conn = await self._connect()
        try:
            col_rows = await conn.fetch(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_name = 'v_call_center_agents'"""
            )
            cols = {r["column_name"] for r in col_rows}
            # Pick the existing status column (priority order)
            target_col = None
            for c in ("agent_status", "status", "state", "agent_state"):
                if c in cols:
                    target_col = c
                    break
            if not target_col:
                raise FusionPBXDBError(
                    "Tabela v_call_center_agents não tem coluna de status conhecida "
                    f"(colunas: {sorted(cols)}). Atualize só localmente."
                )
            await conn.execute(
                f"""UPDATE v_call_center_agents
                    SET {target_col} = $1
                    WHERE call_center_agent_uuid = $2::uuid
                      AND domain_uuid = $3::uuid""",
                status, agent_uuid, self.domain_uuid,
            )
        except FusionPBXDBError:
            raise
        except Exception as e:
            raise FusionPBXDBError(
                f"Falha update_agent_status [{type(e).__name__}]: {e}"
            ) from e
        finally:
            await conn.close()

    async def update_agent_contact(self, agent_uuid: str, extension: str,
                                   domain_name: str) -> str:
        """Update agent_contact (ramal) so calls ring on the chosen extension.
        Returns the new contact string written to the DB.
        """
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        ext = (extension or "").strip()
        if not ext.isdigit():
            raise FusionPBXDBError("Ramal inválido (apenas dígitos)")
        # FusionPBX commonly stores callback contact like:
        #   {sip_h_X-accountcode=ext}user/<ext>@<domain>
        # We use the simpler universally-accepted form:
        new_contact = f"user/{ext}@{domain_name}"
        conn = await self._connect()
        try:
            await conn.execute(
                """UPDATE v_call_center_agents
                   SET agent_contact = $1
                   WHERE call_center_agent_uuid = $2::uuid
                     AND domain_uuid = $3::uuid""",
                new_contact, agent_uuid, self.domain_uuid,
            )
            return new_contact
        except Exception as e:
            raise FusionPBXDBError(
                f"Falha update_agent_contact [{type(e).__name__}]: {e}"
            ) from e
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

    async def get_extension_full(self, extension_uuid: str) -> Optional[Dict[str, Any]]:
        """Retorna TODAS as colunas do ramal em v_extensions. Adapta-se a
        qualquer versão do FusionPBX. Útil para frontend mostrar campos extras
        que possam variar entre versões."""
        conn = await self._connect()
        try:
            cols_rows = await conn.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='v_extensions' ORDER BY ordinal_position")
            avail = [r["column_name"] for r in cols_rows]
            if not avail:
                return None
            # Cast UUID/timestamp para text para serialização JSON
            select_parts = []
            for c in avail:
                if c.endswith("_uuid"):
                    select_parts.append(f"{c}::text AS {c}")
                else:
                    select_parts.append(c)
            sql = (
                f"SELECT {', '.join(select_parts)} "
                f"FROM v_extensions "
                f"WHERE extension_uuid = $1::uuid AND domain_uuid = $2::uuid"
            )
            row = await conn.fetchrow(sql, extension_uuid, self.domain_uuid)
            if not row:
                return None
            d = dict(row)
            # Stringifica datetime/date para JSON
            from datetime import datetime as _dt, date as _date
            for k, v in list(d.items()):
                if isinstance(v, (_dt, _date)):
                    d[k] = v.isoformat()
            return d
        finally:
            await conn.close()

    async def update_extension_full(self, extension_uuid: str,
                                      fields: Dict[str, Any]) -> bool:
        """Atualiza campos do ramal. Aceita: caller_id_name, caller_id_internal,
        caller_id_external, voicemail_enabled, voicemail_password, voicemail_mail_to,
        user_record, call_group, pickup_group, accountcode, description, enabled."""
        if not extension_uuid:
            raise FusionPBXDBError("extension_uuid obrigatório")
        conn = await self._connect()
        try:
            cols_rows = await conn.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='v_extensions'")
            avail = {r["column_name"] for r in cols_rows}
            mapping = {
                "caller_id_name":      ("effective_caller_id_name", str),
                "caller_id_internal":  ("effective_caller_id_number", str),
                "caller_id_external_name": ("outbound_caller_id_name", str),
                "caller_id_external":  ("outbound_caller_id_number", str),
                "voicemail_enabled":   ("voicemail_enabled", lambda v: "true" if v else "false"),
                "voicemail_password":  ("voicemail_password", str),
                "voicemail_mail_to":   ("voicemail_mail_to", str),
                "user_record":         ("user_record", str),  # all|inbound|outbound|local|none
                "call_group":          ("call_group", str),
                "pickup_group":        ("pickup_group", str),
                "accountcode":         ("accountcode", str),
                "description":         ("description", str),
                "enabled":             ("enabled", lambda v: "true" if v else "false"),
            }
            sets, vals = [], []
            for k, v in fields.items():
                if k not in mapping or v is None:
                    continue
                col, conv = mapping[k]
                if col not in avail:
                    continue
                vals.append(conv(v))
                sets.append(f"{col} = ${len(vals)}")
            if not sets:
                return False
            vals.append(extension_uuid)
            vals.append(self.domain_uuid)
            sql = (
                f"UPDATE v_extensions SET {', '.join(sets)} "
                f"WHERE extension_uuid = ${len(vals)-1}::uuid "
                f"AND domain_uuid = ${len(vals)}::uuid"
            )
            res = await conn.execute(sql, *vals)
            return "UPDATE" in res
        finally:
            await conn.close()

    async def list_dialplan_inbound(self) -> List[Dict[str, Any]]:
        """Lista DIDs inbound (registros em v_dialplans com category='Inbound route')."""
        conn = await self._connect()
        try:
            rows = await conn.fetch(
                """SELECT dialplan_uuid::text, dialplan_name, dialplan_number,
                          dialplan_continue, dialplan_context, dialplan_order,
                          dialplan_enabled, dialplan_description
                   FROM v_dialplans
                   WHERE domain_uuid = $1::uuid AND dialplan_category = 'Inbound route'
                   ORDER BY dialplan_number, dialplan_name""",
                self.domain_uuid,
            )
            out = []
            for r in rows:
                d = dict(r)
                d["uuid"] = d.pop("dialplan_uuid")
                # buscar primeiro action transfer/bridge
                acts = await conn.fetch(
                    """SELECT dialplan_action_uuid::text, dialplan_app, dialplan_data, dialplan_order
                       FROM v_dialplan_details
                       WHERE dialplan_uuid = $1::uuid AND dialplan_detail_tag = 'action'
                       ORDER BY dialplan_detail_order""",
                    d["uuid"],
                )
                d["actions"] = [dict(a) for a in acts]
                # destino simplificado: pega o transfer
                target = None
                for a in acts:
                    if a["dialplan_app"] == "transfer":
                        target = (a["dialplan_data"] or "").split(" ")[0]
                        break
                d["target"] = target
                out.append(d)
            return out
        finally:
            await conn.close()

    async def upsert_dialplan_inbound(self, did_number: str, target_extension: str,
                                       name: Optional[str] = None,
                                       enabled: bool = True,
                                       description: str = "",
                                       existing_uuid: Optional[str] = None) -> str:
        """Cria/atualiza um DID inbound em v_dialplans com action transfer
        para target_extension (ramal/fila)."""
        if not self.domain_uuid:
            raise FusionPBXDBError("domain_uuid obrigatório")
        import uuid as _uuid
        conn = await self._connect()
        try:
            label = name or f"DID {did_number} -> {target_extension}"
            ctx = await conn.fetchval(
                "SELECT domain_name FROM v_domains WHERE domain_uuid = $1::uuid",
                self.domain_uuid)
            ctx = ctx or "public"
            if existing_uuid:
                dp_uuid = existing_uuid
                await conn.execute(
                    """UPDATE v_dialplans SET dialplan_name=$1, dialplan_number=$2,
                          dialplan_enabled=$3, dialplan_description=$4
                       WHERE dialplan_uuid=$5::uuid AND domain_uuid=$6::uuid""",
                    label, str(did_number), "true" if enabled else "false",
                    description, dp_uuid, self.domain_uuid,
                )
                # Limpa actions/conditions antigas
                await conn.execute(
                    "DELETE FROM v_dialplan_details WHERE dialplan_uuid=$1::uuid",
                    dp_uuid,
                )
            else:
                dp_uuid = str(_uuid.uuid4())
                await conn.execute(
                    """INSERT INTO v_dialplans
                       (dialplan_uuid, domain_uuid, dialplan_context,
                        dialplan_category, dialplan_name, dialplan_number,
                        dialplan_continue, dialplan_order, dialplan_enabled,
                        dialplan_description)
                       VALUES ($1::uuid, $2::uuid, $3, 'Inbound route', $4, $5,
                               'false', 100, $6, $7)""",
                    dp_uuid, self.domain_uuid, "public", label,
                    str(did_number), "true" if enabled else "false", description,
                )
            # Condition: destination_number = ^DID$
            cond_uuid = str(_uuid.uuid4())
            await conn.execute(
                """INSERT INTO v_dialplan_details
                   (dialplan_detail_uuid, dialplan_uuid, domain_uuid,
                    dialplan_detail_tag, dialplan_detail_type, dialplan_detail_data,
                    dialplan_detail_order, dialplan_detail_enabled)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, 'condition',
                           'destination_number', $4, 10, 'true')""",
                cond_uuid, dp_uuid, self.domain_uuid,
                f"^{did_number}$",
            )
            # Action: transfer XXXX XML domain
            act_uuid = str(_uuid.uuid4())
            await conn.execute(
                """INSERT INTO v_dialplan_details
                   (dialplan_detail_uuid, dialplan_uuid, domain_uuid,
                    dialplan_detail_tag, dialplan_detail_type, dialplan_detail_data,
                    dialplan_detail_order, dialplan_detail_enabled)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, 'action',
                           'transfer', $4, 20, 'true')""",
                act_uuid, dp_uuid, self.domain_uuid,
                f"{target_extension} XML {ctx}",
            )
            return dp_uuid
        finally:
            await conn.close()

    async def delete_dialplan_inbound(self, dialplan_uuid: str) -> None:
        conn = await self._connect()
        try:
            await conn.execute(
                "DELETE FROM v_dialplan_details WHERE dialplan_uuid=$1::uuid AND domain_uuid=$2::uuid",
                dialplan_uuid, self.domain_uuid)
            await conn.execute(
                "DELETE FROM v_dialplans WHERE dialplan_uuid=$1::uuid AND domain_uuid=$2::uuid",
                dialplan_uuid, self.domain_uuid)
        finally:
            await conn.close()

    async def list_gateways(self) -> List[Dict[str, Any]]:
        """Lista troncos SIP (gateways) do tenant."""
        conn = await self._connect()
        try:
            rows = await conn.fetch(
                """SELECT gateway_uuid::text, gateway, username, realm, proxy,
                          register, enabled, description
                   FROM v_gateways
                   WHERE domain_uuid = $1::uuid
                   ORDER BY gateway""",
                self.domain_uuid,
            )
            return [dict(r) for r in rows]
        finally:
            await conn.close()

