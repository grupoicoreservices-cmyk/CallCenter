"""FusionPBX REST API connector.

Since FusionPBX has limited official REST endpoints in the open-source version,
this connector supports two approaches:
  1) Generic REST endpoints (configurable paths) - works with `fusionapi` or custom PHP scripts.
  2) Direct PHP endpoints under /app/* (e.g., /app/registrations/check_registration.php).

Each tenant configures: base_url, api_key (Authorization Bearer) OR username/password,
domain_uuid, recordings_url_template.
"""
from __future__ import annotations
import logging
from typing import Optional, Dict, Any, List
import httpx

logger = logging.getLogger(__name__)


class FusionPBXError(Exception):
    pass


class FusionPBXClient:
    """REST client for FusionPBX. Supports:
       - Bearer token auth (api_key)
       - Basic auth (username/password)
       - FusionPBX-API by Adrian Fretwell (api-key{UUID} inline format)
    """

    def __init__(self, base_url: str, api_key: Optional[str] = None,
                 username: Optional[str] = None, password: Optional[str] = None,
                 domain_uuid: Optional[str] = None, domain_name: Optional[str] = None,
                 verify_ssl: bool = True,
                 custom_paths: Optional[Dict[str, str]] = None,
                 api_style: str = "auto"):
        if not base_url:
            raise FusionPBXError("base_url do FusionPBX não configurado")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.username = username
        self.password = password
        self.domain_uuid = domain_uuid
        self.domain_name = domain_name
        self.verify_ssl = verify_ssl
        self.custom_paths = custom_paths or {}
        # api_style: "auto" | "bearer" | "inline_key" (Fretwell's FusionPBX-API)
        self.api_style = api_style
        self.timeout = httpx.Timeout(30.0)

    def _is_uuid(self, v: Optional[str]) -> bool:
        return bool(v) and len(v) == 36 and v.count("-") == 4

    def _apply_inline_key(self, path: str) -> str:
        """FusionPBX-API by Fretwell requires /api-key{uuid} suffix.
        If api_key is a UUID and path doesn't already contain api-key, append it."""
        if "api-key{" in path:
            return path
        if self.api_style == "inline_key" or (self.api_style == "auto" and self._is_uuid(self.api_key)):
            path = path.rstrip("/")
            return f"{path}/api-key{{{self.api_key}}}"
        return path

    def _auth(self):
        if self.username and self.password:
            return httpx.BasicAuth(self.username, self.password)
        return None

    def _headers(self) -> Dict[str, str]:
        h = {"Accept": "application/json"}
        # Bearer header only if NOT using inline-key style
        if self.api_key and not (self.api_style == "inline_key" or (self.api_style == "auto" and self._is_uuid(self.api_key))):
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        path = self._apply_inline_key(path)
        url = f"{self.base_url}{path}" if path.startswith("/") else f"{self.base_url}/{path}"
        async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify_ssl, follow_redirects=True) as client:
            try:
                r = await client.request(method, url, headers=self._headers(), auth=self._auth(), **kwargs)
            except httpx.HTTPError as e:
                raise FusionPBXError(f"Falha de conexão FusionPBX: {e}") from e
            if r.status_code >= 400:
                raise FusionPBXError(f"FusionPBX {r.status_code} em {path}: {r.text[:300]}")
            ct = r.headers.get("content-type", "")
            if "application/json" in ct:
                try:
                    return r.json()
                except Exception:
                    return {"raw": r.text}
            # FusionPBX-API returns JSON sometimes without the correct content-type
            try:
                return r.json()
            except Exception:
                return {"raw": r.text}

    async def ping(self) -> Dict[str, Any]:
        """Simple health check. Tries /api/status, fallback to /."""
        try:
            return {"ok": True, "data": await self._request("GET", "/api/status")}
        except FusionPBXError:
            try:
                async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify_ssl) as client:
                    r = await client.get(self.base_url, headers=self._headers(), auth=self._auth())
                    return {"ok": r.status_code < 500, "status_code": r.status_code}
            except Exception as e:
                raise FusionPBXError(f"Servidor inacessível: {e}") from e

    def _params_for_style(self, params: dict) -> dict:
        """Fretwell's API uses $_SESSION['domain_uuid'] from the api-key's domain,
        so we don't pass domain_uuid as query param."""
        if self.api_style == "inline_key" or (self.api_style == "auto" and self._is_uuid(self.api_key)):
            params = {k: v for k, v in params.items() if k != "domain_uuid"}
        return params

    async def list_extensions(self) -> List[Dict[str, Any]]:
        """Try custom path first, then common endpoints used by community scripts."""
        params = {}
        if self.domain_uuid: params["domain_uuid"] = self.domain_uuid
        paths = []
        if self.custom_paths.get("extensions"):
            paths.append(self.custom_paths["extensions"])
        paths.extend(["/app/api/extensions", "/api/extensions",
                      "/app/extensions/api/extensions.php",
                      "/api/v1/extensions"])
        last_err = None
        for path in paths:
            try:
                data = await self._request("GET", path, params=self._params_for_style(params))
                if isinstance(data, list): return data
                if isinstance(data, dict):
                    for k in ("data", "extensions", "items", "rows", "users"):
                        if k in data and isinstance(data[k], list): return data[k]
                    if data: return [data]
            except FusionPBXError as e:
                last_err = e
                continue
        raise FusionPBXError(
            f"Nenhum endpoint REST de extensions encontrado. "
            f"Configure 'Path Extensions' na aba Configuração. Último erro: {last_err}"
        )

    async def list_call_center_queues(self) -> List[Dict[str, Any]]:
        params = {}
        if self.domain_uuid: params["domain_uuid"] = self.domain_uuid
        paths = []
        if self.custom_paths.get("queues"):
            paths.append(self.custom_paths["queues"])
        paths.extend(["/app/api/call_center_queues", "/api/call_center_queues",
                      "/app/call_center/api/queues.php", "/api/v1/call_center/queues"])
        last_err = None
        for path in paths:
            try:
                data = await self._request("GET", path, params=self._params_for_style(params))
                if isinstance(data, list): return data
                if isinstance(data, dict):
                    for k in ("data", "queues", "items", "rows", "call_center_queues"):
                        if k in data and isinstance(data[k], list): return data[k]
                    if data: return [data]
            except FusionPBXError as e:
                last_err = e
                continue
        raise FusionPBXError(
            f"Nenhum endpoint REST de queues encontrado. Configure 'Path Queues'. Último erro: {last_err}"
        )

    async def list_call_center_agents(self) -> List[Dict[str, Any]]:
        params = {}
        if self.domain_uuid: params["domain_uuid"] = self.domain_uuid
        paths = []
        if self.custom_paths.get("agents"):
            paths.append(self.custom_paths["agents"])
        paths.extend(["/app/api/call_center_agents", "/api/call_center_agents",
                      "/app/call_center/api/agents.php", "/api/v1/call_center/agents"])
        for path in paths:
            try:
                data = await self._request("GET", path, params=self._params_for_style(params))
                if isinstance(data, list): return data
                if isinstance(data, dict):
                    for k in ("data", "agents", "items", "rows"):
                        if k in data and isinstance(data[k], list): return data[k]
            except FusionPBXError:
                continue
        return []

    async def list_cdr(self, limit: int = 200, start_date: Optional[str] = None,
                       end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"limit": limit}
        if self.domain_uuid: params["domain_uuid"] = self.domain_uuid
        if start_date: params["start_date"] = start_date
        if end_date: params["end_date"] = end_date
        paths = []
        if self.custom_paths.get("cdr"):
            paths.append(self.custom_paths["cdr"])
        paths.extend(["/app/api/xml_cdr", "/api/xml_cdr", "/api/cdr",
                      "/app/xml_cdr/api/cdr.php", "/api/v1/cdr"])
        last_err = None
        for path in paths:
            try:
                data = await self._request("GET", path, params=self._params_for_style(params))
                if isinstance(data, list): return data
                if isinstance(data, dict):
                    for k in ("data", "cdr", "items", "rows", "xml_cdr"):
                        if k in data and isinstance(data[k], list): return data[k]
                    if data: return [data]
            except FusionPBXError as e:
                last_err = e
                continue
        raise FusionPBXError(
            f"Nenhum endpoint REST de CDR encontrado. Configure 'Path CDR'. Último erro: {last_err}"
        )

    async def get_recording_url(self, recording_uuid: str) -> str:
        """Compute URL for a recording. The user can provide a template via base_url + path."""
        return f"{self.base_url}/app/recordings/recording.php?id={recording_uuid}"

    async def list_active_calls(self) -> List[Dict[str, Any]]:
        """Channels currently active in FreeSWITCH (mod_event_socket usually, but FusionPBX may expose REST)."""
        params = {}
        if self.domain_uuid: params["domain_uuid"] = self.domain_uuid
        for path in ("/api/active_calls", "/app/active_calls/api/calls.php", "/api/v1/active_calls"):
            try:
                data = await self._request("GET", path, params=params)
                if isinstance(data, list): return data
                if isinstance(data, dict):
                    for k in ("data", "calls", "items", "rows"):
                        if k in data and isinstance(data[k], list): return data[k]
            except FusionPBXError:
                continue
        return []  # active calls is non-critical, return empty if unsupported


def normalize_extension(ext: Dict[str, Any]) -> Dict[str, Any]:
    """Map FusionPBX extension fields to our internal agent shape."""
    return {
        "external_id": ext.get("extension_uuid") or ext.get("uuid") or ext.get("id"),
        "extension": str(ext.get("extension") or ext.get("number") or ""),
        "name": ext.get("effective_caller_id_name") or ext.get("description") or ext.get("name") or f"Ramal {ext.get('extension', '?')}",
        "username": ext.get("user") or ext.get("username") or str(ext.get("extension", "")),
        "email": ext.get("mwi_account") or ext.get("email") or "",
        "source": "extension",
    }


def normalize_agent(a: Dict[str, Any]) -> Dict[str, Any]:
    """Map FusionPBX call-center agent fields to our internal agent shape.
    Prefers agent_id (login) and agent_name; uses agent_contact for the extension."""
    extension = a.get("extension_from_contact") or ""
    if not extension:
        # fallback: tenta extrair do agent_contact "{...}user/1001@domain"
        contact = (a.get("agent_contact") or "")
        import re
        m = re.search(r"user[/=](\d+)", contact)
        if m:
            extension = m.group(1)
    return {
        "external_id": a.get("call_center_agent_uuid"),
        "extension": str(extension or a.get("agent_id") or ""),
        "name": a.get("agent_name") or f"Agente {a.get('agent_id', '?')}",
        "username": a.get("agent_id") or "",
        "email": "",
        "agent_status": a.get("agent_status"),
        "agent_state": a.get("agent_state"),
        "agent_type": a.get("agent_type"),
        "source": "call_center_agent",
    }


def normalize_queue(q: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "external_id": q.get("call_center_queue_uuid") or q.get("uuid") or q.get("id"),
        "name": q.get("queue_name") or q.get("name") or "Fila",
        "extension": str(q.get("queue_extension") or q.get("extension") or ""),
        "strategy": q.get("queue_strategy") or q.get("strategy") or "ring-all",
        "max_wait": int(q.get("queue_max_wait_time") or q.get("max_wait", 120) or 120),
    }


def _normalize_dt(v: Any) -> str:
    """Convert any FusionPBX timestamp (str/datetime/epoch) to ISO 8601 with timezone.
    Postgres returns 'YYYY-MM-DD HH:MM:SS' (no T, no tz) by default — Mongo string-compare
    fails against ISO with T, breaking date-range filters. Always returns RFC3339-ish:
    'YYYY-MM-DDTHH:MM:SS+00:00'."""
    if v is None or v == "":
        return ""
    # asyncpg returns datetime objects directly when column is timestamp type
    try:
        from datetime import datetime, timezone as _tz, timedelta as _td
        if isinstance(v, datetime):
            if v.tzinfo is None:
                v = v.replace(tzinfo=_tz.utc)
            return v.isoformat()
        s = str(v).strip()
        # epoch (seconds or microseconds)
        try:
            n = float(s)
            if n > 1e12: n = n / 1_000_000.0  # μs
            elif n > 1e10: n = n / 1000.0     # ms
            return datetime.fromtimestamp(n, tz=_tz.utc).isoformat()
        except (ValueError, TypeError):
            pass
        # try fromisoformat (handles "YYYY-MM-DD HH:MM:SS" and ISO)
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_tz.utc)
            return dt.isoformat()
        except ValueError:
            pass
        # last resort: ensure 'T' between date and time so lexicographic compare works
        if " " in s and len(s) >= 19:
            iso = s.replace(" ", "T", 1)
            if "+" not in iso and "Z" not in iso:
                iso = iso + "+00:00"
            return iso
        return s
    except Exception:
        return str(v) if v else ""


def normalize_cdr(c: Dict[str, Any]) -> Dict[str, Any]:
    """Map FusionPBX xml_cdr row to our `calls` schema. Best-effort across variants."""
    direction = c.get("direction") or "inbound"
    disposition_raw = (c.get("hangup_cause") or c.get("disposition") or "").upper()
    if disposition_raw in ("NORMAL_CLEARING", "ANSWERED"):
        disposition = "answered"
    elif disposition_raw in ("ORIGINATOR_CANCEL", "NO_ANSWER", "NO_USER_RESPONSE"):
        disposition = "missed"
    elif disposition_raw in ("NORMAL_TEMPORARY_FAILURE", "USER_BUSY", "CALL_REJECTED"):
        disposition = "abandoned"
    else:
        disposition = "missed"
    duration = int(c.get("duration") or c.get("billsec") or 0)
    return {
        "external_id": c.get("xml_cdr_uuid") or c.get("uuid") or c.get("call_uuid"),
        "direction": direction if direction in ("inbound", "outbound") else "inbound",
        "caller_number": c.get("caller_id_number") or "",
        "callee_number": c.get("destination_number") or "",
        "queue_external_id": c.get("call_center_queue_uuid"),
        "queue_name": c.get("queue_name") or "",
        "agent_external_id": c.get("cc_agent") or c.get("agent_uuid"),
        "duration_sec": duration,
        "wait_sec": int(c.get("waitsec") or 0),
        "disposition": disposition,
        "abandonment_type": "agent_loss" if disposition == "missed" else ("queue_abandon" if disposition == "abandoned" else None),
        "started_at": _normalize_dt(c.get("start_stamp") or c.get("start_date") or c.get("start_epoch")),
        "ended_at": _normalize_dt(c.get("end_stamp") or c.get("end_date") or c.get("end_epoch")),
        "recording_uuid": c.get("record_name") or c.get("recording_uuid"),
    }
