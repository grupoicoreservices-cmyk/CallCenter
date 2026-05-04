"""FreeSWITCH Event Socket Library (ESL) async client.

Used to fetch live calls from FreeSWITCH without depending on any DB tables.
Protocol is plain-text over TCP:
    1. connect → server sends "Content-Type: auth/request\n\n"
    2. send "auth <password>\n\n" → reply "+OK accepted"
    3. send "api show channels as json\n\n" → reply with JSON body
"""
from __future__ import annotations
import asyncio
import json
from typing import Any, Dict, List, Optional


class FreeSwitchESLError(Exception):
    pass


class FreeSwitchESL:
    def __init__(self, host: str, port: int = 8021,
                 password: str = "ClueCon", timeout: float = 5.0):
        self.host = host
        self.port = int(port or 8021)
        self.password = password or "ClueCon"
        self.timeout = float(timeout)

    async def _read_headers(self, reader: asyncio.StreamReader) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=self.timeout)
            if not line:
                break
            line = line.decode("utf-8", errors="replace").rstrip("\r\n")
            if not line:
                break  # blank line = end of headers
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        return headers

    async def _read_body(self, reader: asyncio.StreamReader, n: int) -> bytes:
        buf = b""
        remaining = n
        while remaining > 0:
            chunk = await asyncio.wait_for(reader.read(remaining), timeout=self.timeout)
            if not chunk:
                break
            buf += chunk
            remaining -= len(chunk)
        return buf

    async def _send_command(self, writer: asyncio.StreamWriter,
                            reader: asyncio.StreamReader,
                            cmd: str) -> Dict[str, Any]:
        writer.write((cmd.rstrip() + "\n\n").encode("utf-8"))
        await writer.drain()
        headers = await self._read_headers(reader)
        body = b""
        if "content-length" in headers:
            body = await self._read_body(reader, int(headers["content-length"]))
        return {"headers": headers, "body": body.decode("utf-8", errors="replace")}

    async def connect_and_auth(self) -> tuple:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port),
                timeout=self.timeout,
            )
        except (asyncio.TimeoutError, OSError) as e:
            raise FreeSwitchESLError(f"Conexão TCP falhou em {self.host}:{self.port} → "
                                     f"[{type(e).__name__}] {e}") from e
        # Read auth/request — se ACL bloquear, o FS fecha sem mandar nada
        try:
            initial = await self._read_headers(reader)
        except asyncio.TimeoutError as e:
            writer.close()
            raise FreeSwitchESLError(f"Timeout aguardando auth/request de {self.host}:{self.port}. "
                                     f"Provavelmente ACL bloqueando — verifique apply-inbound-acl no event_socket.conf.xml.") from e
        if not initial:
            try: writer.close()
            except Exception: pass
            raise FreeSwitchESLError(
                f"FreeSWITCH em {self.host}:{self.port} aceitou TCP mas fechou a conexão sem responder. "
                f"Causa típica: ACL bloqueando o IP do Voxyra. "
                f"Solução: crie uma ACL liberando seu IP em /etc/freeswitch/autoload_configs/acl.conf.xml e "
                f"aplique em event_socket.conf.xml (apply-inbound-acl=\"voxyra\"). Depois: fs_cli -x \"reloadxml\" && "
                f"fs_cli -x \"reload mod_event_socket\"."
            )
        # Send auth
        try:
            resp = await self._send_command(writer, reader, f"auth {self.password}")
        except asyncio.TimeoutError as e:
            try: writer.close()
            except Exception: pass
            raise FreeSwitchESLError(
                f"Sem resposta após enviar 'auth' — provavelmente senha ESL incorreta ou ACL bloqueou após accept. "
                f"Verifique o param 'password' em event_socket.conf.xml."
            ) from e
        reply = resp["headers"].get("reply-text", "")
        if not reply.startswith("+OK"):
            try: writer.close()
            except Exception: pass
            raise FreeSwitchESLError(f"Auth ESL falhou: {reply or 'servidor não enviou Reply-Text. Senha incorreta ou ACL bloqueando.'}")
        return reader, writer

    async def show_channels(self) -> List[Dict[str, Any]]:
        """Returns list of active channels via 'show channels as json'."""
        reader, writer = await self.connect_and_auth()
        try:
            resp = await self._send_command(writer, reader, "api show channels as json")
            body = resp["body"].strip()
            if not body or body.startswith("-ERR"):
                return []
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                return []
            rows = data.get("rows") or []
            return rows
        finally:
            try:
                writer.write(b"exit\n\n"); await writer.drain()
                writer.close()
            except Exception:
                pass

    async def ping(self) -> Dict[str, Any]:
        """Test connectivity & auth. Returns 'uptime' / 'version'."""
        reader, writer = await self.connect_and_auth()
        try:
            resp = await self._send_command(writer, reader, "api status")
            return {"ok": True, "status": resp["body"].strip().split("\n")[:5]}
        finally:
            try:
                writer.write(b"exit\n\n"); await writer.drain()
                writer.close()
            except Exception:
                pass


def normalize_esl_channel(c: Dict[str, Any]) -> Dict[str, Any]:
    """Map a row from 'show channels as json' to our internal shape."""
    direction = (c.get("direction") or "").lower()
    if direction == "inbound": direction = "inbound"
    elif direction == "outbound": direction = "outbound"
    else: direction = "inbound"
    state = (c.get("callstate") or c.get("state") or "").upper()
    is_answered = state in ("ACTIVE", "EARLY", "HELD", "RINGING")  # rough
    is_active = state == "ACTIVE"
    return {
        "uuid": c.get("uuid") or "",
        "direction": direction,
        "caller_id_number": c.get("cid_num") or "",
        "caller_id_name": c.get("cid_name") or "",
        "destination_number": c.get("dest") or "",
        "channel_state": c.get("state") or "",
        "answer_state": "answered" if is_active else "ringing",
        "created_epoch": _epoch_from(c.get("created_epoch") or c.get("created")),
        "application": c.get("application") or "",
        "presence_id": c.get("presence_id") or "",
    }


def _epoch_from(v: Any) -> Optional[int]:
    if v is None: return None
    try:
        s = str(v).strip()
        if s.isdigit(): return int(s)
    except Exception:
        pass
    return None
