"""
Voxyra CCA — Modular API Routers
=================================
Cada arquivo neste diretório agrupa endpoints por domínio funcional,
extraídos progressivamente de `server.py` (que historicamente é monolítico).

Padrão de uso (factory):
    # routers/audit_logs.py
    def build_router(deps): -> APIRouter
        router = APIRouter()
        @router.get("/audit-logs")
        async def list_audit_logs(user = Depends(deps["require_permission"]("users.manage"))):
            ...
        return router

    # server.py (no final, antes de api.include_router(api)):
    from routers import audit_logs
    api.include_router(audit_logs.build_router({"db": db, "require_permission": require_permission, ...}))

Esse padrão evita imports circulares e mantém o "wiring" centralizado em server.py.
À medida que mais domínios são extraídos, deps comuns (db, auth helpers) podem ser
movidos para `core/deps.py`.
"""
