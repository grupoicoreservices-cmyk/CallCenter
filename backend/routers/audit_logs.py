"""
Audit Logs router
=================
Lista os registros de auditoria do sistema (quem fez o quê, quando).

Endpoints:
    GET /audit-logs?target_type=&action=&actor_id=&limit=200
        Lista os últimos N logs do tenant atual.
        Permissão: users.manage

Extraído de server.py em 2026-05-11 (P3e — refactor faseado).
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query


def build_router(deps: dict) -> APIRouter:
    """Cria o APIRouter de audit_logs com as dependências passadas por server.py."""
    db = deps["db"]
    require_permission = deps["require_permission"]
    tenant_filter = deps["tenant_filter"]

    router = APIRouter()

    @router.get("/audit-logs")
    async def list_audit_logs(
        user: dict = Depends(require_permission("users.manage")),
        target_type: Optional[str] = None,
        action: Optional[str] = None,
        actor_id: Optional[str] = None,
        limit: int = Query(200, le=1000),
    ):
        q = {**tenant_filter(user)}
        if target_type: q["target_type"] = target_type
        if action: q["action"] = action
        if actor_id: q["actor_id"] = actor_id
        docs = await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
        return {"logs": docs}

    return router
