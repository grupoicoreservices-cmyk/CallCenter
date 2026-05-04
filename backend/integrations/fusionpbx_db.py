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
            # Tabela call_center é opcional. Tenta queues, se não existir tenta ring_groups
            try:
                rows = await conn.fetch(
                    """SELECT call_center_queue_uuid::text, queue_name, queue_extension,
                              queue_strategy, queue_max_wait_time
                       FROM v_call_center_queues
                       WHERE domain_uuid = $1::uuid
                       ORDER BY queue_extension""",
                    self.domain_uuid,
                )
                return [dict(r) for r in rows]
            except asyncpg.UndefinedTableError:
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
            try:
                rows = await conn.fetch(
                    """SELECT call_center_agent_uuid::text, agent_name, agent_id,
                              agent_status, agent_state, agent_contact, agent_type
                       FROM v_call_center_agents
                       WHERE domain_uuid = $1::uuid""",
                    self.domain_uuid,
                )
                return [dict(r) for r in rows]
            except asyncpg.UndefinedTableError:
                return []
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
                            start_stamp::text AS start_stamp,
                            end_stamp::text AS end_stamp,
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
