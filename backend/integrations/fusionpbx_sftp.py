"""SFTP client to fetch FusionPBX recordings.

Recordings are stored on the FusionPBX host typically under:
    /var/lib/freeswitch/recordings/<domain_name>/archive/<YYYY>/<Mon>/<DD>/<file>.{wav,mp3}

Some installs use:
    /var/lib/freeswitch/storage/recordings/...
    /usr/local/freeswitch/recordings/...

We try a list of candidate base paths.
"""
from __future__ import annotations
import os
import asyncio
import logging
from typing import Optional, List, Tuple, AsyncIterator
import asyncssh

logger = logging.getLogger(__name__)


class RecordingFetchError(Exception):
    pass


CANDIDATE_BASE_PATHS = [
    "/var/lib/freeswitch/recordings",
    "/var/lib/freeswitch/storage/recordings",
    "/usr/local/freeswitch/recordings",
    "/var/freeswitch/recordings",
]


async def _connect_sftp(host: str, port: int, username: str,
                        password: Optional[str], key: Optional[str]) -> asyncssh.SSHClientConnection:
    """Open SSH connection. Supports password or PEM private key."""
    kwargs = {
        "host": host, "port": int(port or 22), "username": username,
        "known_hosts": None,  # don't verify; user IPs may rotate
        "client_keys": None,
    }
    if key:
        try:
            kwargs["client_keys"] = [asyncssh.import_private_key(key)]
        except Exception as e:
            raise RecordingFetchError(f"Chave SSH inválida: {e}") from e
    elif password:
        kwargs["password"] = password
    else:
        raise RecordingFetchError("Forneça senha ou chave SSH")
    try:
        return await asyncio.wait_for(asyncssh.connect(**kwargs), timeout=12)
    except (asyncio.TimeoutError, OSError, asyncssh.Error) as e:
        raise RecordingFetchError(
            f"Falha ao conectar SSH em {host}:{port} → [{type(e).__name__}] {e}"
        ) from e


async def find_recording(host: str, port: int, username: str,
                         password: Optional[str], key: Optional[str],
                         relative_or_name: str,
                         base_path: Optional[str] = None,
                         domain_name: Optional[str] = None) -> Tuple[str, int]:
    """Locate the recording file on the remote PBX. Returns (full_path, size_bytes)."""
    name = relative_or_name.replace("fusionpbx://", "").lstrip("/")
    candidates: List[str] = []
    if name.startswith("/"):
        candidates.append(name)
    else:
        bases = [base_path] if base_path else list(CANDIDATE_BASE_PATHS)
        for base in bases:
            if not base: continue
            # Try plain filename in base/<domain>
            if domain_name:
                candidates.append(os.path.join(base, domain_name, "archive", name))
                candidates.append(os.path.join(base, domain_name, name))
            candidates.append(os.path.join(base, name))
    conn = await _connect_sftp(host, port, username, password, key)
    try:
        async with conn.start_sftp_client() as sftp:
            for candidate in candidates:
                try:
                    st = await sftp.stat(candidate)
                    return candidate, int(st.size or 0)
                except (asyncssh.SFTPError, OSError):
                    continue
            # Also try recursive search if name has no path separators
            if "/" not in name:
                for base in (base_path,) if base_path else CANDIDATE_BASE_PATHS:
                    if not base: continue
                    try:
                        # Use find via SSH (faster than recursing SFTP)
                        result = await conn.run(
                            f"find {base} -name '{name}' -type f 2>/dev/null | head -1",
                            check=False,
                        )
                        path = (result.stdout or "").strip().splitlines()[0] if result.stdout else ""
                        if path:
                            try:
                                st = await sftp.stat(path)
                                return path, int(st.size or 0)
                            except Exception: pass
                    except Exception: pass
            raise RecordingFetchError(
                f"Gravação '{name}' não encontrada nos caminhos: {candidates[:3]}…"
            )
    finally:
        conn.close()
        await conn.wait_closed()


async def stream_recording(host: str, port: int, username: str,
                           password: Optional[str], key: Optional[str],
                           remote_path: str,
                           offset: int = 0, length: Optional[int] = None,
                           chunk_size: int = 64 * 1024) -> AsyncIterator[bytes]:
    """Async generator yielding bytes from the remote recording file.
    Supports byte-range (offset/length) for HTTP Range responses."""
    conn = await _connect_sftp(host, port, username, password, key)
    try:
        sftp = await conn.start_sftp_client()
        try:
            f = await sftp.open(remote_path, "rb")
            try:
                if offset:
                    await f.seek(offset)
                remaining = length
                while True:
                    n = chunk_size if remaining is None else min(chunk_size, remaining)
                    if n <= 0: break
                    chunk = await f.read(n)
                    if not chunk: break
                    yield chunk
                    if remaining is not None:
                        remaining -= len(chunk)
            finally:
                await f.close()
        finally:
            sftp.exit()
            await sftp.wait_closed()
    finally:
        conn.close()
        await conn.wait_closed()
