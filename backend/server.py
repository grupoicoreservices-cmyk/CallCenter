from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import random
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

import bcrypt
import jwt
import re
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, validator

from integrations.asaas import AsaasClient, AsaasError, map_asaas_status
from integrations.paypal import PayPalClient, PayPalError, map_paypal_status
from integrations.fusionpbx import (
    FusionPBXClient, FusionPBXError,
    normalize_extension, normalize_agent, normalize_queue, normalize_cdr,
)
from integrations.fusionpbx_db import FusionPBXDBClient, FusionPBXDBError

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

def validate_email_str(v: str) -> str:
    if not v or not isinstance(v, str): raise ValueError("Email inválido")
    v = v.strip().lower()
    if not EMAIL_RE.match(v): raise ValueError("Formato de email inválido")
    return v

# ---------- DB ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Voxyra CCA - Callcenter Analytical")
api = APIRouter(prefix="/api")

# ---------- Auth helpers ----------
JWT_ALGO = "HS256"

def _secret(): return os.environ["JWT_SECRET"]

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try: return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception: return False

def create_access_token(user_id: str, email: str, role: str, tenant_id: Optional[str]) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role, "tenant_id": tenant_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGO)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "): token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGO])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Usuário não encontrado")
        # Super admin can have an active tenant context via header (for impersonation)
        if user.get("role") == "super_admin":
            ctx = request.headers.get("X-Tenant-Context")
            user["_tenant_context"] = ctx or None
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

# ---------- Permissions ----------
ALL_PERMISSIONS = [
    {"key": "dashboard.view",       "label": "Ver Dashboard",                 "group": "Dashboard"},
    {"key": "realtime.view",        "label": "Ver Chamadas em Tempo Real",    "group": "Operação"},
    {"key": "tv.view",              "label": "Acessar Painel TV",             "group": "Operação"},
    {"key": "recordings.view_own",  "label": "Ouvir suas próprias gravações", "group": "Gravações"},
    {"key": "recordings.view_all",  "label": "Ouvir gravações de toda equipe","group": "Gravações"},
    {"key": "recordings.download",  "label": "Baixar gravações",              "group": "Gravações"},
    {"key": "recordings.edit_notes","label": "Adicionar anotações em gravações","group": "Gravações"},
    {"key": "reports.view",         "label": "Ver relatórios",                "group": "Relatórios"},
    {"key": "reports.export",       "label": "Exportar relatórios (Excel/PDF)","group": "Relatórios"},
    {"key": "queues.view",          "label": "Ver filas",                     "group": "Filas"},
    {"key": "queues.edit",          "label": "Editar filas",                  "group": "Filas"},
    {"key": "agents.view",          "label": "Ver agentes",                   "group": "Agentes"},
    {"key": "agents.edit",          "label": "Editar agentes",                "group": "Agentes"},
    {"key": "users.manage",         "label": "Gerenciar usuários",            "group": "Administração"},
    {"key": "tenant.settings",      "label": "Configurar empresa (tenant)",   "group": "Administração"},
]

DEFAULT_PERMISSIONS_BY_ROLE = {
    "super_admin": [p["key"] for p in ALL_PERMISSIONS],
    "admin": [p["key"] for p in ALL_PERMISSIONS if p["key"] != "tenants.manage"],
    "supervisor": [
        "dashboard.view", "realtime.view", "tv.view",
        "recordings.view_all", "recordings.download", "recordings.edit_notes",
        "reports.view", "reports.export",
        "queues.view", "queues.edit",
        "agents.view", "agents.edit",
    ],
    "agent": ["dashboard.view", "recordings.view_own", "reports.view"],
}

def effective_permissions(user: dict) -> List[str]:
    if user.get("role") in ("super_admin", "admin"):
        return DEFAULT_PERMISSIONS_BY_ROLE[user["role"]]
    perms = user.get("permissions")
    if perms is None:
        return DEFAULT_PERMISSIONS_BY_ROLE.get(user.get("role", "agent"), [])
    return perms

def require_permission(perm: str):
    async def checker(user: dict = Depends(get_current_user)):
        if perm not in effective_permissions(user):
            raise HTTPException(status_code=403, detail="Sem permissão")
        return user
    return checker

def require_super_admin():
    async def checker(user: dict = Depends(get_current_user)):
        if user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Apenas super-admin")
        return user
    return checker

def tenant_scope(user: dict) -> Optional[str]:
    """Returns the tenant_id to scope queries by. None means no scoping (super admin without context)."""
    if user.get("role") == "super_admin":
        return user.get("_tenant_context")  # may be None => global
    return user.get("tenant_id")

def tenant_filter(user: dict) -> Dict[str, Any]:
    tid = tenant_scope(user)
    return {"tenant_id": tid} if tid else {}

async def require_tenant_or_super(user: dict) -> str:
    """For write operations: returns the tenant_id to use. Super admin must have context."""
    tid = tenant_scope(user)
    if not tid:
        raise HTTPException(status_code=400, detail="Selecione um tenant antes de executar esta operação")
    return tid

# ---------- Models ----------
class LoginReq(BaseModel):
    domain: Optional[str] = None
    email: str
    password: str
    @validator("email")
    def _e(cls, v): return validate_email_str(v)

class TenantCreate(BaseModel):
    domain: str
    name: str
    accent_color: str = "#0EA5E9"
    logo_url: Optional[str] = None
    timezone: str = "America/Sao_Paulo"
    max_users: int = 50
    max_agents: int = 50
    active: bool = True
    plan_id: Optional[str] = None
    contract_value: Optional[float] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    payment_status: str = "pending"  # paid | pending | overdue | trial

class TenantUpdate(BaseModel):
    name: Optional[str] = None
    accent_color: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: Optional[str] = None
    max_users: Optional[int] = None
    max_agents: Optional[int] = None
    active: Optional[bool] = None
    plan_id: Optional[str] = None
    contract_value: Optional[float] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    payment_status: Optional[str] = None

class PlanCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    monthly_price: float
    max_users: int = 10
    max_agents: int = 10
    features: List[str] = []
    active: bool = True

class PlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    monthly_price: Optional[float] = None
    max_users: Optional[int] = None
    max_agents: Optional[int] = None
    features: Optional[List[str]] = None
    active: Optional[bool] = None

def _serialize_tenant(t: dict) -> dict:
    return {k: t.get(k) for k in [
        "id", "domain", "name", "accent_color", "logo_url",
        "timezone", "max_users", "max_agents", "active", "created_at",
        "plan_id", "contract_value", "contract_start", "contract_end", "payment_status",
    ]}

def _serialize_plan(p: dict) -> dict:
    return {k: p.get(k) for k in ["id", "name", "description", "monthly_price",
                                   "max_users", "max_agents", "features", "active", "created_at"]}

# ---------- Auth Endpoints ----------
def _set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True,
        secure=False, samesite="lax", max_age=8 * 3600, path="/",
    )

@api.post("/auth/login")
async def login(body: LoginReq, response: Response):
    email = body.email.lower()
    domain = (body.domain or "").strip().lower()
    if domain:
        tenant = await db.tenants.find_one({"domain": domain})
        if not tenant:
            raise HTTPException(status_code=401, detail="Domínio não encontrado")
        if not tenant.get("active", True):
            raise HTTPException(status_code=403, detail="Tenant suspenso")
        user = await db.users.find_one({"tenant_id": tenant["id"], "email": email})
    else:
        # Super-admin login (no tenant)
        user = await db.users.find_one({"email": email, "role": "super_admin"})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Usuário desativado")
    token = create_access_token(user["id"], user["email"], user["role"], user.get("tenant_id"))
    _set_auth_cookie(response, token)
    try:
        await write_audit(user, "login", "user", user["id"], f"{user.get('name')} <{user.get('email')}>", {"domain": domain})
    except Exception: pass
    return {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "role": user["role"], "tenant_id": user.get("tenant_id"),
        "permissions": effective_permissions(user), "token": token,
    }

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    out = {k: user.get(k) for k in ["id", "email", "name", "role", "tenant_id", "active"]}
    out["permissions"] = effective_permissions(user)
    if user.get("role") == "super_admin":
        out["tenant_context"] = user.get("_tenant_context")
    # attach tenant info
    tid = user.get("tenant_id") or user.get("_tenant_context")
    if tid:
        t = await db.tenants.find_one({"id": tid}, {"_id": 0})
        if t: out["tenant"] = _serialize_tenant(t)
    return out

@api.get("/auth/branding")
async def get_branding(domain: str = Query(...)):
    """Public endpoint: return tenant branding by domain (used on login screen)."""
    tenant = await db.tenants.find_one({"domain": domain.strip().lower(), "active": True}, {"_id": 0})
    if not tenant:
        return {"found": False}
    return {
        "found": True,
        "name": tenant.get("name"),
        "accent_color": tenant.get("accent_color"),
        "logo_url": tenant.get("logo_url"),
    }

# ---------- Audit ----------
async def write_audit(actor: dict, action: str, target_type: str, target_id: str, target_label: str, changes: Optional[dict] = None):
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": actor.get("tenant_id"),
        "action": action, "target_type": target_type,
        "target_id": target_id, "target_label": target_label,
        "actor_id": actor.get("id"), "actor_email": actor.get("email"), "actor_name": actor.get("name"),
        "changes": changes or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.audit_logs.insert_one(doc)

# ---------- Tenants (super admin) ----------
@api.get("/tenants")
async def list_tenants(user: dict = Depends(require_super_admin())):
    docs = await db.tenants.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    out = []
    for t in docs:
        users = await db.users.count_documents({"tenant_id": t["id"]})
        agents = await db.agents.count_documents({"tenant_id": t["id"]})
        out.append({**_serialize_tenant(t), "user_count": users, "agent_count": agents})
    return {"tenants": out}

@api.post("/tenants")
async def create_tenant(body: TenantCreate, user: dict = Depends(require_super_admin())):
    domain = body.domain.strip().lower()
    if not domain or " " in domain:
        raise HTTPException(status_code=400, detail="Domínio inválido")
    if await db.tenants.find_one({"domain": domain}):
        raise HTTPException(status_code=400, detail="Domínio já cadastrado")
    tid = str(uuid.uuid4())
    doc = {
        "id": tid, "domain": domain, "name": body.name,
        "accent_color": body.accent_color, "logo_url": body.logo_url,
        "timezone": body.timezone, "max_users": body.max_users,
        "max_agents": body.max_agents, "active": body.active,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tenants.insert_one(doc)
    await write_audit(user, "create", "tenant", tid, f"{body.name} ({domain})", {"domain": domain})
    return _serialize_tenant(doc)

@api.patch("/tenants/{tid}")
async def update_tenant(tid: str, body: TenantUpdate, user: dict = Depends(require_super_admin())):
    target = await db.tenants.find_one({"id": tid})
    if not target: raise HTTPException(status_code=404, detail="Tenant não encontrado")
    update = {}
    changes = {}
    for f in ["name", "accent_color", "logo_url", "timezone", "max_users", "max_agents", "active"]:
        v = getattr(body, f)
        if v is not None and v != target.get(f):
            update[f] = v
            changes[f] = {"from": target.get(f), "to": v}
    if update:
        await db.tenants.update_one({"id": tid}, {"$set": update})
        await write_audit(user, "update", "tenant", tid, target.get("name", ""), changes)
    fresh = await db.tenants.find_one({"id": tid}, {"_id": 0})
    return _serialize_tenant(fresh)

@api.delete("/tenants/{tid}")
async def delete_tenant(tid: str, user: dict = Depends(require_super_admin())):
    target = await db.tenants.find_one({"id": tid})
    if not target: raise HTTPException(status_code=404, detail="Tenant não encontrado")
    # Cascade delete tenant data
    for col in ("users", "agents", "queues", "calls", "recordings", "audit_logs"):
        await db[col].delete_many({"tenant_id": tid})
    await db.tenants.delete_one({"id": tid})
    await write_audit(user, "delete", "tenant", tid, target.get("name", ""), {"domain": target.get("domain")})
    return {"ok": True}

@api.post("/tenants/{tid}/impersonate")
async def impersonate_tenant(tid: str, user: dict = Depends(require_super_admin())):
    """Set super admin's active tenant context. Frontend should send X-Tenant-Context header."""
    t = await db.tenants.find_one({"id": tid})
    if not t: raise HTTPException(status_code=404, detail="Tenant não encontrado")
    return {"tenant": _serialize_tenant(t)}

@api.get("/tenants/{tid}/stats")
async def tenant_stats(tid: str, user: dict = Depends(require_super_admin())):
    """Usage statistics for a single tenant - super admin view."""
    t = await db.tenants.find_one({"id": tid})
    if not t: raise HTTPException(status_code=404, detail="Tenant não encontrado")
    f = {"tenant_id": tid}
    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    users_count = await db.users.count_documents(f)
    agents_count = await db.agents.count_documents(f)
    queues_count = await db.queues.count_documents(f)
    calls_30d = await db.calls.count_documents({**f, "started_at": {"$gte": cutoff_30d}})
    answered_30d = await db.calls.count_documents({**f, "started_at": {"$gte": cutoff_30d}, "disposition": "answered"})
    recordings = await db.recordings.find({**f, "started_at": {"$gte": cutoff_30d}}, {"_id": 0, "duration_sec": 1, "size_mb": 1}).to_list(5000)
    total_minutes = sum(r.get("duration_sec", 0) for r in recordings) / 60
    total_storage_mb = sum(r.get("size_mb", 0) for r in recordings)
    # Plan info
    plan = None
    if t.get("plan_id"):
        plan = await db.plans.find_one({"id": t["plan_id"]}, {"_id": 0})
    return {
        "tenant": _serialize_tenant(t),
        "plan": _serialize_plan(plan) if plan else None,
        "usage": {
            "users": users_count, "users_limit": t.get("max_users", 0),
            "agents": agents_count, "agents_limit": t.get("max_agents", 0),
            "queues": queues_count,
            "calls_30d": calls_30d,
            "answered_30d": answered_30d,
            "recording_minutes_30d": round(total_minutes, 1),
            "recording_storage_mb": round(total_storage_mb, 1),
            "recordings_count_30d": len(recordings),
        },
    }

# ---------- Plan Features Catalog ----------
PLAN_FEATURES_CATALOG = [
    {"group": "Operação", "key": "dashboard",            "label": "Dashboard analítico",            "description": "KPIs, gráficos e abandonos"},
    {"group": "Operação", "key": "realtime",             "label": "Monitor em Tempo Real",          "description": "Chamadas ao vivo + status agentes"},
    {"group": "Operação", "key": "tv_panel",             "label": "Painel TV (wallboard)",          "description": "Modo TV com auto-refresh"},
    {"group": "Operação", "key": "tv_customization",     "label": "Personalização Painel TV",       "description": "Temas, rotação, alertas sonoros"},
    {"group": "Gravações","key": "recordings",           "label": "Gravações de chamadas",          "description": "Acesso ao acervo de gravações"},
    {"group": "Gravações","key": "recordings_download",  "label": "Download de gravações",          "description": "Baixar arquivos de áudio"},
    {"group": "Gravações","key": "recordings_notes",     "label": "Anotações em gravações",         "description": "Adicionar comentários por chamada"},
    {"group": "Gravações","key": "ai_analysis",          "label": "Análise por IA (sentimento)",    "description": "Transcrição + score de qualidade"},
    {"group": "Filas",    "key": "queues_view",          "label": "Visualizar filas",               "description": "Estatísticas e fila atual"},
    {"group": "Filas",    "key": "queues_edit",          "label": "Editar filas",                   "description": "Criar/configurar filas"},
    {"group": "Filas",    "key": "abandoned_analytics",  "label": "Análise de abandonos",           "description": "Por hora/dia/semana e tipo"},
    {"group": "Agentes",  "key": "agents_view",          "label": "Listar agentes",                 "description": "Visualizar equipe"},
    {"group": "Agentes",  "key": "agents_edit",          "label": "Gerenciar agentes",              "description": "Editar perfis e status"},
    {"group": "Agentes",  "key": "agent_scoring",        "label": "Performance/CSAT por agente",    "description": "Ranking e métricas"},
    {"group": "Relatórios","key":"reports",              "label": "Relatórios padrão",              "description": "6 tipos de relatório"},
    {"group": "Relatórios","key":"reports_export",       "label": "Exportar Excel/PDF",             "description": "Download de relatórios"},
    {"group": "Relatórios","key":"custom_reports",       "label": "Relatórios customizados",        "description": "Criar relatórios sob medida"},
    {"group": "Administração","key":"users_management",  "label": "Gerenciar usuários",             "description": "CRUD de usuários e permissões"},
    {"group": "Administração","key":"audit_logs",        "label": "Logs de auditoria",              "description": "Histórico de ações"},
    {"group": "Administração","key":"multi_supervisor",  "label": "Múltiplos supervisores",         "description": "Mais de 1 supervisor"},
    {"group": "Marca",    "key": "white_label",          "label": "White-label",                    "description": "Logo + cor próprios"},
    {"group": "Marca",    "key": "custom_domain",        "label": "Domínio personalizado",          "description": "Acesso por domínio próprio"},
    {"group": "Integrações","key":"api_access",          "label": "Acesso à API REST",              "description": "Tokens de API para integração"},
    {"group": "Integrações","key":"webhooks",            "label": "Webhooks",                       "description": "Notificações de eventos"},
    {"group": "Suporte",  "key": "support_email",        "label": "Suporte por email",              "description": "Resposta em até 48h"},
    {"group": "Suporte",  "key": "support_priority",     "label": "Suporte prioritário",            "description": "Resposta em até 4h"},
    {"group": "Suporte",  "key": "support_dedicated",    "label": "Gerente dedicado",               "description": "Atendimento exclusivo"},
    {"group": "Suporte",  "key": "sla_99",               "label": "SLA 99,9%",                      "description": "Disponibilidade garantida"},
]

@api.get("/plans/features-catalog")
async def plans_features_catalog(user: dict = Depends(get_current_user)):
    return {"features": PLAN_FEATURES_CATALOG}

# ---------- Plans (super admin) ----------
@api.get("/plans")
async def list_plans(user: dict = Depends(get_current_user)):
    """Public to authenticated users so tenants can see their plan info."""
    docs = await db.plans.find({}, {"_id": 0}).sort("monthly_price", 1).to_list(100)
    return {"plans": [_serialize_plan(p) for p in docs]}

@api.post("/plans")
async def create_plan(body: PlanCreate, user: dict = Depends(require_super_admin())):
    pid = str(uuid.uuid4())
    doc = {"id": pid, **body.dict(), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.plans.insert_one(doc)
    await write_audit(user, "create", "plan", pid, body.name, {"price": body.monthly_price})
    return _serialize_plan(doc)

@api.patch("/plans/{pid}")
async def update_plan(pid: str, body: PlanUpdate, user: dict = Depends(require_super_admin())):
    target = await db.plans.find_one({"id": pid})
    if not target: raise HTTPException(status_code=404, detail="Plano não encontrado")
    update = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if update:
        await db.plans.update_one({"id": pid}, {"$set": update})
        await write_audit(user, "update", "plan", pid, target.get("name", ""), update)
    fresh = await db.plans.find_one({"id": pid}, {"_id": 0})
    return _serialize_plan(fresh)

@api.delete("/plans/{pid}")
async def delete_plan(pid: str, user: dict = Depends(require_super_admin())):
    target = await db.plans.find_one({"id": pid})
    if not target: raise HTTPException(status_code=404, detail="Plano não encontrado")
    in_use = await db.tenants.count_documents({"plan_id": pid})
    if in_use:
        raise HTTPException(status_code=400, detail=f"Plano em uso por {in_use} tenant(s). Mova-os antes de excluir.")
    await db.plans.delete_one({"id": pid})
    await write_audit(user, "delete", "plan", pid, target.get("name", ""), {})
    return {"ok": True}

# ---------- Logo upload (local FS) ----------
import shutil
from fastapi import UploadFile, File
from fastapi.staticfiles import StaticFiles

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

@api.post("/uploads/logo")
async def upload_logo(file: UploadFile = File(...), user: dict = Depends(require_super_admin())):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in {"png", "jpg", "jpeg", "webp", "svg", "gif"}:
        raise HTTPException(status_code=400, detail="Formato inválido (use png/jpg/webp/svg)")
    filename = f"{uuid.uuid4()}.{ext}"
    path = UPLOAD_DIR / filename
    with path.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    # URL served via /uploads/<filename>
    return {"url": f"/uploads/{filename}", "filename": filename, "size": path.stat().st_size}

# ---------- Billing settings (placeholder for Asaas/PayPal credentials) ----------
class BillingSettings(BaseModel):
    asaas_api_key: Optional[str] = None
    asaas_environment: str = "production"  # production | sandbox
    asaas_webhook_token: Optional[str] = None
    paypal_client_id: Optional[str] = None
    paypal_client_secret: Optional[str] = None
    paypal_environment: str = "live"  # live | sandbox
    paypal_webhook_id: Optional[str] = None
    enabled_methods: List[str] = []  # ["pix", "boleto", "credit_card", "paypal"]

@api.get("/billing/settings")
async def get_billing_settings(user: dict = Depends(require_super_admin())):
    doc = await db.billing_settings.find_one({"id": "global"}, {"_id": 0}) or {}
    # mask secrets
    out = {**doc}
    for k in ("asaas_api_key", "asaas_webhook_token", "paypal_client_secret"):
        if out.get(k):
            v = out[k]
            out[k] = v[:6] + "•" * (len(v) - 10) + v[-4:] if len(v) > 12 else "••••"
            out[f"{k}_set"] = True
        else:
            out[f"{k}_set"] = False
    return out

@api.put("/billing/settings")
async def update_billing_settings(body: BillingSettings, user: dict = Depends(require_super_admin())):
    payload = body.dict(exclude_unset=True)
    # Don't overwrite secrets if a masked value was sent back
    existing = await db.billing_settings.find_one({"id": "global"}) or {}
    for k in ("asaas_api_key", "asaas_webhook_token", "paypal_client_secret"):
        if k in payload and payload[k] and "•" in str(payload[k]):
            payload[k] = existing.get(k)  # keep existing
    await db.billing_settings.update_one({"id": "global"}, {"$set": {"id": "global", **payload}}, upsert=True)
    await write_audit(user, "update", "billing_settings", "global", "Configurações de cobrança", {"fields": list(payload.keys())})
    return {"ok": True}

# ---------- Permissions metadata ----------
@api.get("/permissions")
async def list_permissions(user: dict = Depends(require_permission("users.manage"))):
    return {
        "permissions": ALL_PERMISSIONS,
        "defaults": DEFAULT_PERMISSIONS_BY_ROLE,
        "roles": [
            {"key": "admin", "label": "Administrador"},
            {"key": "supervisor", "label": "Supervisor"},
            {"key": "agent", "label": "Agente"},
        ],
    }

# ---------- Users ----------
class UserCreate(BaseModel):
    email: str; password: str; name: str
    role: str = "agent"
    permissions: Optional[List[str]] = None
    active: bool = True
    agent_id: Optional[str] = None
    @validator("email")
    def _e(cls, v): return validate_email_str(v)

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    permissions: Optional[List[str]] = None
    active: Optional[bool] = None
    agent_id: Optional[str] = None

def _serialize_user(u: dict) -> dict:
    return {
        "id": u["id"], "email": u["email"], "name": u.get("name", ""),
        "role": u.get("role", "agent"), "tenant_id": u.get("tenant_id"),
        "permissions": u.get("permissions") or DEFAULT_PERMISSIONS_BY_ROLE.get(u.get("role", "agent"), []),
        "is_custom_permissions": u.get("permissions") is not None,
        "active": u.get("active", True), "agent_id": u.get("agent_id"),
        "created_at": u.get("created_at"),
    }

@api.get("/users")
async def list_users(user: dict = Depends(require_permission("users.manage"))):
    f = tenant_filter(user)
    docs = await db.users.find({**f, "role": {"$ne": "super_admin"}}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(500)
    return {"users": [_serialize_user(u) for u in docs]}

@api.post("/users")
async def create_user(body: UserCreate, user: dict = Depends(require_permission("users.manage"))):
    if body.role not in ("admin", "supervisor", "agent"):
        raise HTTPException(status_code=400, detail="Papel inválido")
    tid = await require_tenant_or_super(user)
    tenant = await db.tenants.find_one({"id": tid})
    cnt = await db.users.count_documents({"tenant_id": tid})
    if tenant and cnt >= tenant.get("max_users", 999):
        raise HTTPException(status_code=400, detail=f"Limite de {tenant['max_users']} usuários atingido para este tenant")
    email = body.email.lower()
    if await db.users.find_one({"tenant_id": tid, "email": email}):
        raise HTTPException(status_code=400, detail="Email já cadastrado neste tenant")
    if body.permissions is not None:
        invalid = [p for p in body.permissions if p not in {x["key"] for x in ALL_PERMISSIONS}]
        if invalid: raise HTTPException(status_code=400, detail=f"Permissões inválidas: {invalid}")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "tenant_id": tid, "email": email, "name": body.name, "role": body.role,
        "password_hash": hash_password(body.password),
        "permissions": body.permissions, "active": body.active, "agent_id": body.agent_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    await write_audit(user, "create", "user", uid, f"{body.name} <{email}>", {
        "role": body.role, "tenant_id": tid,
        "permissions_mode": "custom" if body.permissions is not None else "default",
    })
    return _serialize_user(doc)

@api.patch("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdate, user: dict = Depends(require_permission("users.manage"))):
    f = tenant_filter(user)
    target = await db.users.find_one({"id": user_id, **f})
    if not target: raise HTTPException(status_code=404, detail="Usuário não encontrado")
    update = {}; changes = {}
    if body.name is not None and body.name != target.get("name"):
        update["name"] = body.name; changes["name"] = {"from": target.get("name"), "to": body.name}
    if body.role is not None and body.role != target.get("role"):
        if body.role not in ("admin", "supervisor", "agent"):
            raise HTTPException(status_code=400, detail="Papel inválido")
        update["role"] = body.role; changes["role"] = {"from": target.get("role"), "to": body.role}
    if body.password:
        update["password_hash"] = hash_password(body.password); changes["password"] = "changed"
    if body.permissions is not None:
        invalid = [p for p in body.permissions if p not in {x["key"] for x in ALL_PERMISSIONS}]
        if invalid: raise HTTPException(status_code=400, detail=f"Permissões inválidas: {invalid}")
        update["permissions"] = body.permissions
        changes["permissions"] = {"count": len(body.permissions), "mode": "custom"}
    if body.active is not None and body.active != target.get("active", True):
        update["active"] = body.active; changes["active"] = {"from": target.get("active", True), "to": body.active}
    if body.agent_id is not None and body.agent_id != target.get("agent_id"):
        update["agent_id"] = body.agent_id; changes["agent_id"] = {"from": target.get("agent_id"), "to": body.agent_id}
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
        await write_audit(user, "update", "user", user_id, f"{target.get('name')} <{target.get('email')}>", changes)
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return _serialize_user(fresh)

@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_permission("users.manage"))):
    if user["id"] == user_id: raise HTTPException(status_code=400, detail="Você não pode excluir a si mesmo")
    f = tenant_filter(user)
    target = await db.users.find_one({"id": user_id, **f})
    if not target: raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if target.get("role") == "admin":
        cnt = await db.users.count_documents({"role": "admin", "tenant_id": target.get("tenant_id")})
        if cnt <= 1: raise HTTPException(status_code=400, detail="Não é possível remover o último administrador do tenant")
    await db.users.delete_one({"id": user_id})
    await write_audit(user, "delete", "user", user_id, f"{target.get('name')} <{target.get('email')}>", {"role": target.get("role")})
    return {"ok": True}

@api.get("/audit-logs")
async def list_audit_logs(
    user: dict = Depends(require_permission("users.manage")),
    target_type: Optional[str] = None, action: Optional[str] = None,
    actor_id: Optional[str] = None, limit: int = Query(200, le=1000),
):
    q = {**tenant_filter(user)}
    if target_type: q["target_type"] = target_type
    if action: q["action"] = action
    if actor_id: q["actor_id"] = actor_id
    docs = await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"logs": docs}

# ---------- Helpers / Constants ----------
DISPOSITION_LABELS = {"answered": "Atendida", "missed": "Perdida", "abandoned": "Abandonada", "voicemail": "Correio de Voz"}
DIRECTION_LABELS = {"inbound": "Entrada", "outbound": "Saída"}
ABANDON_LABELS = {"agent_loss": "Perda de Agente", "queue_abandon": "Cliente na Fila"}
SAMPLE_AUDIO = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
STATUSES = ["online", "incall", "paused", "offline"]
CALL_DIR = ["inbound", "outbound"]
DISPOSITIONS = ["answered", "missed", "abandoned", "voicemail"]
AGENT_AVATARS = [
    "https://images.unsplash.com/photo-1770058428276-7ca3d2f98568?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwyfHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
    "https://images.unsplash.com/photo-1612276529418-52e6ad86ee1d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHw0fHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
    "https://images.unsplash.com/photo-1712744626457-3ffa4ba32c8c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwxfHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
    "https://images.unsplash.com/photo-1685688739798-bce206ab6b42?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwzfHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
]

def fmt_br_datetime(iso: Optional[str]) -> str:
    if not iso: return "—"
    try: return datetime.fromisoformat(iso).strftime("%d/%m/%Y %H:%M")
    except Exception: return iso

# ---------- Dashboard endpoints ----------
@api.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(require_permission("dashboard.view"))):
    f = tenant_filter(user)
    total_agents = await db.agents.count_documents(f)
    online_agents = await db.agents.count_documents({**f, "status": {"$in": ["online", "incall", "paused"]}})
    incall = await db.agents.count_documents({**f, "status": "incall"})
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    answered = await db.calls.count_documents({**f, "disposition": "answered", "started_at": {"$gte": today}})
    missed = await db.calls.count_documents({**f, "disposition": {"$in": ["missed", "abandoned"]}, "started_at": {"$gte": today}})
    queues = await db.queues.find(f, {"_id": 0}).to_list(50)
    waiting = sum(q.get("waiting", 0) for q in queues)
    avg_wait = int(sum(q.get("avg_wait_sec", 0) for q in queues) / max(len(queues), 1))
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=23)).isoformat()
    cur = db.calls.find({**f, "started_at": {"$gte": cutoff}}, {"_id": 0, "started_at": 1, "disposition": 1})
    buckets = {h: {"hour": f"{h:02d}h", "answered": 0, "missed": 0} for h in range(24)}
    async for c in cur:
        try:
            h = datetime.fromisoformat(c["started_at"]).hour
            if c["disposition"] == "answered": buckets[h]["answered"] += 1
            elif c["disposition"] in ("missed", "abandoned"): buckets[h]["missed"] += 1
        except Exception: pass
    return {
        "total_agents": total_agents, "online_agents": online_agents, "incall_agents": incall,
        "answered_today": answered, "missed_today": missed,
        "waiting_in_queue": waiting, "avg_wait_sec": avg_wait,
        "hourly": [buckets[h] for h in range(24)],
    }

@api.get("/dashboard/abandoned")
async def dashboard_abandoned(user: dict = Depends(require_permission("dashboard.view"))):
    f = tenant_filter(user)
    now = datetime.now(timezone.utc)
    hour_buckets = {h: {"label": f"{h:02d}h", "agent_loss": 0, "queue_abandon": 0} for h in range(24)}
    day_buckets = []
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_buckets.append({"key": d.isoformat(), "label": d.strftime("%a %d/%m"), "agent_loss": 0, "queue_abandon": 0})
    week_buckets = []
    for i in range(3, -1, -1):
        day = now - timedelta(days=now.weekday() + 7 * i)
        day = day.replace(hour=0, minute=0, second=0, microsecond=0)
        week_buckets.append({"key": day.isoformat(), "label": f"Sem {day.strftime('%d/%m')}", "agent_loss": 0, "queue_abandon": 0})
    cutoff_hour = (now - timedelta(hours=23)).isoformat()
    cutoff_day = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff_week = (now - timedelta(days=now.weekday() + 7 * 3)).replace(hour=0, minute=0, second=0, microsecond=0)
    earliest = min(cutoff_week, datetime.fromisoformat(cutoff_hour))
    cursor = db.calls.find({**f, "disposition": {"$in": ["missed", "abandoned"]}, "started_at": {"$gte": earliest.isoformat()}},
                           {"_id": 0, "started_at": 1, "abandonment_type": 1, "queue_name": 1})
    total_hour = {"agent_loss": 0, "queue_abandon": 0}
    total_day = {"agent_loss": 0, "queue_abandon": 0}
    total_week = {"agent_loss": 0, "queue_abandon": 0}
    by_queue: Dict[str, dict] = {}
    async for c in cursor:
        try: dt = datetime.fromisoformat(c["started_at"])
        except Exception: continue
        at = c.get("abandonment_type")
        if at not in ("agent_loss", "queue_abandon"): continue
        if dt.isoformat() >= cutoff_hour:
            hour_buckets[dt.hour][at] += 1; total_hour[at] += 1
        day_key = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        if day_key >= cutoff_day:
            for b in day_buckets:
                if b["key"] == day_key.isoformat(): b[at] += 1; total_day[at] += 1; break
        week_start = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        if week_start >= cutoff_week:
            for b in week_buckets:
                if b["key"] == week_start.isoformat(): b[at] += 1; total_week[at] += 1; break
        if day_key >= cutoff_day:
            qn = c.get("queue_name", "—")
            if qn not in by_queue: by_queue[qn] = {"queue": qn, "agent_loss": 0, "queue_abandon": 0}
            by_queue[qn][at] += 1
    return {
        "by_hour": [hour_buckets[h] for h in range(24)],
        "by_day": day_buckets, "by_week": week_buckets,
        "totals": {"last_24h": total_hour, "last_7d": total_day, "last_4w": total_week},
        "by_queue": sorted(by_queue.values(), key=lambda x: x["agent_loss"] + x["queue_abandon"], reverse=True),
    }

@api.get("/realtime/calls")
async def realtime_calls(user: dict = Depends(require_permission("realtime.view"))):
    f = tenant_filter(user)
    tid = tenant_scope(user)
    # Try to get live calls from FusionPBX if integration is enabled
    if tid:
        s = await db.fusionpbx_settings.find_one({"tenant_id": tid})
        if s and s.get("enabled") and s.get("base_url"):
            try:
                client = FusionPBXClient(
                    base_url=s["base_url"], api_key=s.get("api_key"),
                    username=s.get("username"), password=s.get("password"),
                    domain_uuid=s.get("domain_uuid"), domain_name=s.get("domain_name"),
                    verify_ssl=bool(s.get("verify_ssl", True)),
                )
                raw = await client.list_active_calls()
                if raw:
                    calls = []
                    for c in raw:
                        calls.append({
                            "id": c.get("uuid") or c.get("call_uuid") or str(uuid.uuid4()),
                            "agent_name": c.get("agent_name") or c.get("cc_agent") or "—",
                            "agent_extension": str(c.get("destination") or c.get("extension") or "—"),
                            "agent_avatar": None,
                            "queue_name": c.get("queue_name") or "—",
                            "caller_number": c.get("caller_id_number") or c.get("cid_num") or "—",
                            "direction": c.get("direction") if c.get("direction") in ("inbound", "outbound") else "inbound",
                            "elapsed_sec": int(c.get("duration", 0) or 0),
                            "status": "incall" if c.get("answer_state") == "answered" else "ringing",
                        })
                    return {"calls": calls, "source": "fusionpbx"}
            except FusionPBXError:
                pass  # fallback to DB
    # Fallback: just show agents currently in "incall" status (no fake data)
    agents = await db.agents.find({**f, "status": "incall"}, {"_id": 0}).to_list(100)
    queues = {q["id"]: q for q in await db.queues.find(f, {"_id": 0}).to_list(100)}
    active = []
    for a in agents:
        qid = a["queues"][0] if a.get("queues") else None
        q = queues.get(qid, {})
        active.append({
            "id": str(uuid.uuid4()),
            "agent_name": a["name"], "agent_extension": a["extension"], "agent_avatar": a.get("avatar"),
            "queue_name": q.get("name", "—"),
            "caller_number": "—",
            "direction": "inbound", "elapsed_sec": 0, "status": "incall",
        })
    return {"calls": active, "source": "local"}

@api.get("/agents")
async def list_agents(user: dict = Depends(require_permission("agents.view"))):
    items = await db.agents.find(tenant_filter(user), {"_id": 0}).to_list(500)
    return {"agents": items}

@api.get("/agents/{agent_id}")
async def get_agent(agent_id: str, user: dict = Depends(require_permission("agents.view"))):
    f = tenant_filter(user)
    a = await db.agents.find_one({"id": agent_id, **f}, {"_id": 0})
    if not a: raise HTTPException(status_code=404, detail="Agente não encontrado")
    recent = await db.calls.find({"agent_id": agent_id, **f}, {"_id": 0}).sort("started_at", -1).to_list(20)
    return {"agent": a, "recent_calls": recent}

@api.get("/queues")
async def list_queues(user: dict = Depends(require_permission("queues.view"))):
    f = tenant_filter(user)
    items = await db.queues.find(f, {"_id": 0}).to_list(500)
    agents = await db.agents.find(f, {"_id": 0, "queues": 1}).to_list(500)
    for q in items:
        q["agent_count"] = sum(1 for a in agents if q["id"] in a.get("queues", []))
    return {"queues": items}

# ---------- Recordings ----------
@api.get("/recordings")
async def list_recordings(
    user: dict = Depends(get_current_user),
    agent_id: Optional[str] = None, queue_id: Optional[str] = None,
    search: Optional[str] = None, limit: int = Query(100, le=500),
):
    perms = effective_permissions(user)
    has_all = "recordings.view_all" in perms
    has_own = "recordings.view_own" in perms
    if not (has_all or has_own): raise HTTPException(status_code=403, detail="Sem permissão")
    q = {**tenant_filter(user)}
    if not has_all and has_own:
        own_id = user.get("agent_id")
        if not own_id: return {"recordings": []}
        q["agent_id"] = own_id
    elif agent_id: q["agent_id"] = agent_id
    if queue_id: q["queue_id"] = queue_id
    if search:
        q["$or"] = [
            {"caller_number": {"$regex": search, "$options": "i"}},
            {"agent_name": {"$regex": search, "$options": "i"}},
        ]
    items = await db.recordings.find(q, {"_id": 0}).sort("started_at", -1).to_list(limit)
    return {"recordings": items}

@api.get("/recordings/{rec_id}")
async def get_recording(rec_id: str, user: dict = Depends(get_current_user)):
    perms = effective_permissions(user)
    if not ("recordings.view_all" in perms or "recordings.view_own" in perms):
        raise HTTPException(status_code=403, detail="Sem permissão")
    r = await db.recordings.find_one({"id": rec_id, **tenant_filter(user)}, {"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Gravação não encontrada")
    if "recordings.view_all" not in perms and r.get("agent_id") != user.get("agent_id"):
        raise HTTPException(status_code=403, detail="Sem permissão para esta gravação")
    return r

class NoteUpdate(BaseModel):
    notes: str

@api.patch("/recordings/{rec_id}")
async def update_recording(rec_id: str, body: NoteUpdate, user: dict = Depends(require_permission("recordings.edit_notes"))):
    res = await db.recordings.update_one({"id": rec_id, **tenant_filter(user)}, {"$set": {"notes": body.notes}})
    if res.matched_count == 0: raise HTTPException(status_code=404, detail="Não encontrada")
    return {"ok": True}

# ---------- Reports ----------
def _period_cutoff(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "today": return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "30d": return now - timedelta(days=30)
    return now - timedelta(days=7)

async def _build_report(user: dict, report_type: str, period: str, agent_id: Optional[str], queue_id: Optional[str]):
    cutoff = _period_cutoff(period).isoformat()
    f = tenant_filter(user)
    if report_type == "agents":
        agents = await db.agents.find(f, {"_id": 0}).to_list(500)
        if agent_id: agents = [a for a in agents if a["id"] == agent_id]
        rows = []
        for a in agents:
            base = {"agent_id": a["id"], "started_at": {"$gte": cutoff}, **f}
            answered = await db.calls.count_documents({**base, "disposition": "answered"})
            missed = await db.calls.count_documents({**base, "disposition": {"$in": ["missed", "abandoned"]}})
            rows.append({"agent_name": a["name"], "extension": a["extension"], "status": a.get("status"),
                         "answered": answered, "missed": missed,
                         "avg_handle_sec": a.get("avg_handle_sec", 0),
                         "csat": a.get("csat", 0), "adherence_pct": a.get("adherence_pct", 0)})
        rows.sort(key=lambda r: r["answered"], reverse=True)
        return {"title": "Performance de Agentes", "columns": [
            {"key": "agent_name", "label": "Agente"}, {"key": "extension", "label": "Ramal"},
            {"key": "status", "label": "Status"}, {"key": "answered", "label": "Atendidas"},
            {"key": "missed", "label": "Perdidas"}, {"key": "avg_handle_sec", "label": "TMA (s)"},
            {"key": "csat", "label": "CSAT"}, {"key": "adherence_pct", "label": "Aderência %"},
        ], "rows": rows}
    if report_type == "queues":
        queues = await db.queues.find(f, {"_id": 0}).to_list(500)
        if queue_id: queues = [q for q in queues if q["id"] == queue_id]
        rows = []
        for q in queues:
            base = {"queue_id": q["id"], "started_at": {"$gte": cutoff}, **f}
            answered = await db.calls.count_documents({**base, "disposition": "answered"})
            missed = await db.calls.count_documents({**base, "disposition": {"$in": ["missed", "abandoned"]}})
            total = answered + missed
            rows.append({"queue_name": q["name"], "extension": q["extension"], "strategy": q["strategy"],
                         "answered": answered, "missed": missed, "total": total,
                         "sla_pct": round((answered / total) * 100, 1) if total else 0.0,
                         "avg_wait_sec": q.get("avg_wait_sec", 0)})
        rows.sort(key=lambda r: r["total"], reverse=True)
        return {"title": "Chamadas por Fila", "columns": [
            {"key": "queue_name", "label": "Fila"}, {"key": "extension", "label": "Ext."},
            {"key": "strategy", "label": "Estratégia"}, {"key": "answered", "label": "Atendidas"},
            {"key": "missed", "label": "Perdidas"}, {"key": "total", "label": "Total"},
            {"key": "sla_pct", "label": "SLA %"}, {"key": "avg_wait_sec", "label": "TME (s)"},
        ], "rows": rows}
    if report_type == "calls":
        q = {**f, "started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.calls.find(q, {"_id": 0}).sort("started_at", -1).to_list(2000)
        rows = [{"started_at": fmt_br_datetime(d.get("started_at")),
                 "agent_name": d.get("agent_name", "—"), "queue_name": d.get("queue_name", "—"),
                 "direction": DIRECTION_LABELS.get(d.get("direction"), "—"),
                 "caller_number": d.get("caller_number", "—"),
                 "disposition": DISPOSITION_LABELS.get(d.get("disposition"), "—"),
                 "duration_sec": d.get("duration_sec", 0), "wait_sec": d.get("wait_sec", 0)} for d in docs]
        return {"title": "Histórico de Chamadas (CDR)", "columns": [
            {"key": "started_at", "label": "Data/Hora"}, {"key": "agent_name", "label": "Agente"},
            {"key": "queue_name", "label": "Fila"}, {"key": "direction", "label": "Direção"},
            {"key": "caller_number", "label": "Número"}, {"key": "disposition", "label": "Status"},
            {"key": "duration_sec", "label": "Duração (s)"}, {"key": "wait_sec", "label": "Espera (s)"},
        ], "rows": rows}
    if report_type == "abandoned":
        q = {**f, "disposition": {"$in": ["missed", "abandoned"]}, "started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.calls.find(q, {"_id": 0}).sort("started_at", -1).to_list(2000)
        rows = [{"started_at": fmt_br_datetime(d.get("started_at")),
                 "abandonment_type": ABANDON_LABELS.get(d.get("abandonment_type"), "—"),
                 "queue_name": d.get("queue_name", "—"), "agent_name": d.get("agent_name", "—"),
                 "caller_number": d.get("caller_number", "—"), "wait_sec": d.get("wait_sec", 0)} for d in docs]
        return {"title": "Chamadas Abandonadas", "columns": [
            {"key": "started_at", "label": "Data/Hora"}, {"key": "abandonment_type", "label": "Tipo"},
            {"key": "queue_name", "label": "Fila"}, {"key": "agent_name", "label": "Agente"},
            {"key": "caller_number", "label": "Número"}, {"key": "wait_sec", "label": "Espera (s)"},
        ], "rows": rows}
    if report_type == "recordings":
        q = {**f, "started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.recordings.find(q, {"_id": 0}).sort("started_at", -1).to_list(2000)
        rows = [{"started_at": fmt_br_datetime(d.get("started_at")),
                 "agent_name": d.get("agent_name", "—"), "queue_name": d.get("queue_name", "—"),
                 "caller_number": d.get("caller_number", "—"),
                 "duration_sec": d.get("duration_sec", 0), "size_mb": d.get("size_mb", 0)} for d in docs]
        return {"title": "Gravações", "columns": [
            {"key": "started_at", "label": "Data/Hora"}, {"key": "agent_name", "label": "Agente"},
            {"key": "queue_name", "label": "Fila"}, {"key": "caller_number", "label": "Número"},
            {"key": "duration_sec", "label": "Duração (s)"}, {"key": "size_mb", "label": "Tamanho (MB)"},
        ], "rows": rows}
    if report_type == "hourly":
        q = {**f, "started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.calls.find(q, {"_id": 0, "started_at": 1, "disposition": 1}).to_list(5000)
        buckets = {h: {"hour": f"{h:02d}h", "answered": 0, "missed": 0, "total": 0} for h in range(24)}
        for d in docs:
            try:
                h = datetime.fromisoformat(d["started_at"]).hour
                buckets[h]["total"] += 1
                if d["disposition"] == "answered": buckets[h]["answered"] += 1
                elif d["disposition"] in ("missed", "abandoned"): buckets[h]["missed"] += 1
            except Exception: pass
        return {"title": "Produtividade Horária", "columns": [
            {"key": "hour", "label": "Hora"}, {"key": "answered", "label": "Atendidas"},
            {"key": "missed", "label": "Perdidas"}, {"key": "total", "label": "Total"},
        ], "rows": [buckets[h] for h in range(24)]}
    raise HTTPException(status_code=400, detail="Tipo de relatório inválido")

@api.get("/reports/agents")
async def reports_agents(user: dict = Depends(require_permission("reports.view"))):
    f = tenant_filter(user)
    agents = await db.agents.find(f, {"_id": 0}).to_list(500)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = []
    for a in agents:
        base = {"agent_id": a["id"], "started_at": {"$gte": cutoff}, **f}
        answered = await db.calls.count_documents({**base, "disposition": "answered"})
        missed = await db.calls.count_documents({**base, "disposition": {"$in": ["missed", "abandoned"]}})
        rows.append({"agent_id": a["id"], "agent_name": a["name"], "avatar": a.get("avatar"),
                     "status": a.get("status"), "answered_7d": answered, "missed_7d": missed,
                     "avg_handle_sec": a.get("avg_handle_sec", 0), "csat": a.get("csat", 0),
                     "adherence_pct": a.get("adherence_pct", 0), "calls_handled": a.get("calls_handled", 0)})
    rows.sort(key=lambda r: r["answered_7d"], reverse=True)
    return {"rows": rows}

@api.get("/reports/types")
async def reports_types(user: dict = Depends(require_permission("reports.view"))):
    return {"types": [
        {"key": "agents", "label": "Performance de Agentes"},
        {"key": "queues", "label": "Chamadas por Fila"},
        {"key": "calls", "label": "Histórico de Chamadas (CDR)"},
        {"key": "abandoned", "label": "Chamadas Abandonadas"},
        {"key": "recordings", "label": "Gravações"},
        {"key": "hourly", "label": "Produtividade Horária"},
    ]}

@api.get("/reports/data")
async def reports_data(type: str, period: str = "7d", agent_id: Optional[str] = None, queue_id: Optional[str] = None,
                       user: dict = Depends(require_permission("reports.view"))):
    return await _build_report(user, type, period, agent_id, queue_id)

@api.get("/reports/export")
async def reports_export(type: str, format: str = "xlsx", period: str = "7d",
                         agent_id: Optional[str] = None, queue_id: Optional[str] = None,
                         user: dict = Depends(require_permission("reports.export"))):
    from fastapi.responses import StreamingResponse
    import io
    data = await _build_report(user, type, period, agent_id, queue_id)
    filename_base = f"{type}_{period}_{datetime.now().strftime('%Y%m%d_%H%M')}"
    if format == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        wb = Workbook(); ws = wb.active; ws.title = data["title"][:30]
        ws.append([data["title"]]); ws["A1"].font = Font(bold=True, size=14)
        ws.append([f"Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}  ·  Período: {period}"])
        ws.append([])
        ws.append([c["label"] for c in data["columns"]])
        for cell in ws[ws.max_row]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="09090B")
            cell.alignment = Alignment(horizontal="left")
        for row in data["rows"]:
            ws.append([row.get(c["key"], "") for c in data["columns"]])
        for col in ws.columns:
            max_len = max((len(str(c.value)) if c.value is not None else 0) for c in col)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)
        buf = io.BytesIO(); wb.save(buf); buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'})
    if format == "pdf":
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=20, rightMargin=20, topMargin=25, bottomMargin=20)
        styles = getSampleStyleSheet(); story = []
        story.append(Paragraph(f"<b>{data['title']}</b>", styles["Title"]))
        story.append(Paragraph(f"Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}  ·  Período: {period}", styles["Normal"]))
        story.append(Spacer(1, 12))
        headers = [c["label"] for c in data["columns"]]
        table_data = [headers]
        for row in data["rows"]:
            table_data.append([str(row.get(c["key"], "")) for c in data["columns"]])
        if len(table_data) == 1:
            table_data.append(["Sem dados para o período selecionado."] + [""] * (len(headers) - 1))
        tbl = Table(table_data, repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#09090B")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E4E4E7")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(tbl); doc.build(story); buf.seek(0)
        return StreamingResponse(buf, media_type="application/pdf",
                                 headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'})
    raise HTTPException(status_code=400, detail="Formato inválido. Use xlsx ou pdf.")

# ---------- Billing: Charges (Asaas + PayPal) ----------
class ChargeCreate(BaseModel):
    tenant_id: str
    gateway: str  # asaas | paypal
    method: str   # pix | boleto | credit_card | paypal
    amount: float
    description: Optional[str] = None
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    customer_cpf_cnpj: Optional[str] = None  # required for Asaas
    customer_phone: Optional[str] = None
    due_date: Optional[str] = None  # YYYY-MM-DD; defaults to +7d for Asaas
    currency: str = "BRL"  # PayPal


def _serialize_charge(c: dict) -> dict:
    return {k: c.get(k) for k in [
        "id", "tenant_id", "gateway", "method", "amount", "currency", "status",
        "description", "external_id", "invoice_url", "checkout_url",
        "pix_qrcode", "pix_payload", "boleto_url", "barcode",
        "customer_name", "customer_email", "due_date", "paid_at",
        "created_at", "updated_at",
    ] if c.get(k) is not None}


async def _load_billing_settings() -> dict:
    return await db.billing_settings.find_one({"id": "global"}, {"_id": 0}) or {}


async def _get_asaas_client() -> AsaasClient:
    s = await _load_billing_settings()
    api_key = s.get("asaas_api_key")
    if not api_key:
        raise HTTPException(status_code=400, detail="Asaas não configurado. Vá em Cobrança → Asaas.")
    env = s.get("asaas_environment", "sandbox")
    return AsaasClient(api_key=api_key, environment=env)


async def _get_paypal_client() -> PayPalClient:
    s = await _load_billing_settings()
    cid = s.get("paypal_client_id")
    secret = s.get("paypal_client_secret")
    if not cid or not secret:
        raise HTTPException(status_code=400, detail="PayPal não configurado. Vá em Cobrança → PayPal.")
    env = s.get("paypal_environment", "sandbox")
    return PayPalClient(client_id=cid, client_secret=secret, environment=env)


@api.post("/billing/charges")
async def create_charge(body: ChargeCreate, user: dict = Depends(require_super_admin())):
    tenant = await db.tenants.find_one({"id": body.tenant_id})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant não encontrado")

    cid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    base_doc = {
        "id": cid, "tenant_id": body.tenant_id,
        "gateway": body.gateway, "method": body.method,
        "amount": float(body.amount), "currency": body.currency,
        "description": body.description or f"Mensalidade {tenant.get('name','')}",
        "customer_name": body.customer_name or tenant.get("name"),
        "customer_email": body.customer_email,
        "customer_cpf_cnpj": body.customer_cpf_cnpj,
        "due_date": body.due_date,
        "status": "pending",
        "created_at": now, "updated_at": now,
    }

    try:
        if body.gateway == "asaas":
            method_map = {"pix": "PIX", "boleto": "BOLETO", "credit_card": "CREDIT_CARD"}
            billing_type = method_map.get(body.method)
            if not billing_type:
                raise HTTPException(status_code=400, detail="Método inválido para Asaas. Use pix/boleto/credit_card.")
            if not body.customer_cpf_cnpj:
                raise HTTPException(status_code=400, detail="CPF/CNPJ do cliente é obrigatório para Asaas")
            client = await _get_asaas_client()
            cpf = "".join(ch for ch in body.customer_cpf_cnpj if ch.isdigit())
            customer = await client.find_customer_by_cpf(cpf)
            if not customer:
                customer = await client.create_customer(
                    name=base_doc["customer_name"] or "Cliente", cpf_cnpj=cpf,
                    email=body.customer_email, mobile_phone=body.customer_phone,
                )
            due = body.due_date or (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
            payment = await client.create_payment(
                customer_id=customer["id"], billing_type=billing_type,
                value=float(body.amount), due_date=due,
                description=base_doc["description"], external_reference=cid,
            )
            base_doc["external_id"] = payment.get("id")
            base_doc["external_customer_id"] = customer["id"]
            base_doc["invoice_url"] = payment.get("invoiceUrl")
            base_doc["status"] = map_asaas_status(payment.get("status", "PENDING"))
            base_doc["due_date"] = due
            # Get payment-method-specific data
            if billing_type == "PIX":
                try:
                    qr = await client.get_pix_qrcode(payment["id"])
                    base_doc["pix_qrcode"] = qr.get("encodedImage")  # base64 PNG
                    base_doc["pix_payload"] = qr.get("payload")
                except Exception as e:
                    logger.warning("PIX QR fetch failed: %s", e)
            elif billing_type == "BOLETO":
                base_doc["boleto_url"] = payment.get("bankSlipUrl")
                try:
                    bd = await client.get_boleto_url(payment["id"])
                    base_doc["barcode"] = bd.get("identificationField")
                except Exception: pass
            base_doc["raw"] = payment

        elif body.gateway == "paypal":
            client_pp = await _get_paypal_client()
            order = await client_pp.create_order(
                amount=float(body.amount), currency=body.currency,
                reference_id=cid, description=base_doc["description"],
            )
            base_doc["external_id"] = order.get("id")
            base_doc["status"] = map_paypal_status(order.get("status", "CREATED"))
            for link in order.get("links", []):
                if link.get("rel") == "approve":
                    base_doc["checkout_url"] = link.get("href")
                    break
            base_doc["raw"] = order
        else:
            raise HTTPException(status_code=400, detail="Gateway inválido. Use asaas ou paypal.")
    except (AsaasError, PayPalError) as e:
        raise HTTPException(status_code=502, detail=str(e))

    await db.charges.insert_one(base_doc)
    await write_audit(user, "create", "charge", cid,
                      f"{body.gateway}/{body.method} R$ {body.amount:.2f}",
                      {"tenant_id": body.tenant_id, "gateway": body.gateway})
    return _serialize_charge(base_doc)

@api.get("/billing/charges")
async def list_charges(
    user: dict = Depends(require_super_admin()),
    tenant_id: Optional[str] = None, status: Optional[str] = None,
    limit: int = Query(100, le=500),
):
    q: Dict[str, Any] = {}
    if tenant_id: q["tenant_id"] = tenant_id
    if status: q["status"] = status
    docs = await db.charges.find(q, {"_id": 0, "raw": 0}).sort("created_at", -1).to_list(limit)
    return {"charges": [_serialize_charge(c) for c in docs]}


@api.get("/billing/charges/{cid}")
async def get_charge(cid: str, user: dict = Depends(require_super_admin())):
    c = await db.charges.find_one({"id": cid}, {"_id": 0, "raw": 0})
    if not c: raise HTTPException(status_code=404, detail="Cobrança não encontrada")
    return _serialize_charge(c)


@api.post("/billing/charges/{cid}/sync")
async def sync_charge(cid: str, user: dict = Depends(require_super_admin())):
    """Pulls fresh status from gateway."""
    c = await db.charges.find_one({"id": cid})
    if not c: raise HTTPException(status_code=404, detail="Cobrança não encontrada")
    try:
        if c["gateway"] == "asaas":
            client = await _get_asaas_client()
            payment = await client.get_payment(c["external_id"])
            new_status = map_asaas_status(payment.get("status", "PENDING"))
        elif c["gateway"] == "paypal":
            client_pp = await _get_paypal_client()
            order = await client_pp.get_order(c["external_id"])
            new_status = map_paypal_status(order.get("status", "CREATED"))
        else:
            raise HTTPException(status_code=400, detail="Gateway inválido")
    except (AsaasError, PayPalError) as e:
        raise HTTPException(status_code=502, detail=str(e))

    update = {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if new_status == "paid" and not c.get("paid_at"):
        update["paid_at"] = update["updated_at"]
        # Also mark tenant as paid
        await db.tenants.update_one({"id": c["tenant_id"]}, {"$set": {"payment_status": "paid"}})
    await db.charges.update_one({"id": cid}, {"$set": update})
    fresh = await db.charges.find_one({"id": cid}, {"_id": 0, "raw": 0})
    return _serialize_charge(fresh)


@api.post("/billing/charges/{cid}/capture")
async def capture_paypal_charge(cid: str, user: dict = Depends(require_super_admin())):
    """For PayPal orders that have been approved by buyer; capture funds."""
    c = await db.charges.find_one({"id": cid})
    if not c: raise HTTPException(status_code=404, detail="Cobrança não encontrada")
    if c["gateway"] != "paypal":
        raise HTTPException(status_code=400, detail="Capture é apenas para PayPal")
    try:
        client_pp = await _get_paypal_client()
        result = await client_pp.capture_order(c["external_id"])
    except PayPalError as e:
        raise HTTPException(status_code=502, detail=str(e))
    new_status = map_paypal_status(result.get("status", "COMPLETED"))
    update = {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if new_status == "paid":
        update["paid_at"] = update["updated_at"]
        await db.tenants.update_one({"id": c["tenant_id"]}, {"$set": {"payment_status": "paid"}})
    await db.charges.update_one({"id": cid}, {"$set": update})
    return {"ok": True, "status": new_status}


# ---------- Webhooks ----------
@api.post("/webhooks/asaas")
async def webhook_asaas(request: Request):
    """Asaas posts JSON. Authenticated via header `asaas-access-token`."""
    settings = await _load_billing_settings()
    expected_token = settings.get("asaas_webhook_token")
    sent_token = request.headers.get("asaas-access-token") or request.headers.get("Asaas-Access-Token")
    if expected_token and sent_token != expected_token:
        raise HTTPException(status_code=401, detail="Webhook token inválido")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Corpo JSON inválido")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Esperado um objeto JSON")
    event = body.get("event", "")
    payment = body.get("payment", {}) or {}
    delivery_id = body.get("id") or payment.get("id")
    if delivery_id and await db.webhook_events.find_one({"delivery_id": delivery_id, "source": "asaas"}):
        return {"ok": True, "duplicate": True}
    asaas_pid = payment.get("id")
    if asaas_pid:
        c = await db.charges.find_one({"external_id": asaas_pid, "gateway": "asaas"})
        if c:
            new_status = map_asaas_status(payment.get("status", "PENDING"))
            update = {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
            if new_status == "paid":
                update["paid_at"] = update["updated_at"]
                await db.tenants.update_one({"id": c["tenant_id"]}, {"$set": {"payment_status": "paid"}})
            await db.charges.update_one({"id": c["id"]}, {"$set": update})
    await db.webhook_events.insert_one({
        "id": str(uuid.uuid4()), "source": "asaas", "delivery_id": delivery_id,
        "event": event, "payload": body,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@api.post("/webhooks/paypal")
async def webhook_paypal(request: Request):
    """PayPal sends signed events. We store + try to update charge status."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Corpo JSON inválido")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Esperado um objeto JSON")
    event_type = body.get("event_type", "")
    resource = body.get("resource", {}) or {}
    delivery_id = body.get("id")
    if delivery_id and await db.webhook_events.find_one({"delivery_id": delivery_id, "source": "paypal"}):
        return {"ok": True, "duplicate": True}
    # Try to extract order ID; events: PAYMENT.CAPTURE.COMPLETED, CHECKOUT.ORDER.APPROVED, etc.
    order_id = None
    if "supplementary_data" in resource:
        rel = resource.get("supplementary_data", {}).get("related_ids", {})
        order_id = rel.get("order_id")
    order_id = order_id or resource.get("id")
    if order_id:
        c = await db.charges.find_one({"external_id": order_id, "gateway": "paypal"})
        if c:
            status_in_event = resource.get("status") or ("COMPLETED" if "CAPTURE.COMPLETED" in event_type else None)
            new_status = map_paypal_status(status_in_event or "")
            if new_status:
                update = {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
                if new_status == "paid":
                    update["paid_at"] = update["updated_at"]
                    await db.tenants.update_one({"id": c["tenant_id"]}, {"$set": {"payment_status": "paid"}})
                await db.charges.update_one({"id": c["id"]}, {"$set": update})
    await db.webhook_events.insert_one({
        "id": str(uuid.uuid4()), "source": "paypal", "delivery_id": delivery_id,
        "event": event_type, "payload": body,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


# ---------- FusionPBX Integration ----------
class FusionPBXSettings(BaseModel):
    enabled: bool = False
    # Connection type: "rest" (default) or "db" (direct PostgreSQL)
    connection_type: str = "rest"
    # REST mode fields
    base_url: str = ""
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    verify_ssl: bool = True
    path_extensions: Optional[str] = None
    path_queues: Optional[str] = None
    path_agents: Optional[str] = None
    path_cdr: Optional[str] = None
    # DB mode fields
    db_host: Optional[str] = None
    db_port: int = 5432
    db_name: str = "fusionpbx"
    db_username: Optional[str] = None
    db_password: Optional[str] = None
    db_ssl: bool = False
    # Common
    domain_uuid: Optional[str] = None
    domain_name: Optional[str] = None
    sync_interval_minutes: int = 1


def _serialize_fusion_settings(s: Optional[dict], mask: bool = True) -> dict:
    if not s: return {"enabled": False, "configured": False, "connection_type": "rest"}
    out = {k: s.get(k) for k in [
        "enabled", "connection_type",
        "base_url", "username", "domain_uuid", "domain_name",
        "verify_ssl", "sync_interval_minutes", "last_sync_at", "last_sync_status",
        "path_extensions", "path_queues", "path_agents", "path_cdr",
        "db_host", "db_port", "db_name", "db_username", "db_ssl",
    ]}
    out["connection_type"] = s.get("connection_type") or "rest"
    if out["connection_type"] == "db":
        out["configured"] = bool(s.get("db_host") and s.get("db_username"))
    else:
        out["configured"] = bool(s.get("base_url"))
    out["api_key_set"] = bool(s.get("api_key"))
    out["password_set"] = bool(s.get("password"))
    out["db_password_set"] = bool(s.get("db_password"))
    if not mask:
        out["api_key"] = s.get("api_key")
        out["password"] = s.get("password")
        out["db_password"] = s.get("db_password")
    return out


async def _resolve_tenant_for_fusion(user: dict, tenant_id: Optional[str]) -> str:
    if user.get("role") == "super_admin":
        # Accept explicit ?tenant_id=... OR the X-Tenant-Context header (impersonation)
        tid = tenant_id or user.get("_tenant_context")
        if not tid:
            raise HTTPException(status_code=400, detail="Selecione um tenant antes de configurar a central PBX (entre no tenant via página Tenants)")
        return tid
    return user["tenant_id"]


# ---------- System Updates (Super Admin Self-Host Tool) ----------
import subprocess
import asyncio

_UPDATE_STATE: Dict[str, Any] = {"running": False, "log": [], "started_at": None, "finished_at": None, "success": None}
APP_ROOT = Path("/opt/CallCenter")
FRONTEND_BUILD = APP_ROOT / "frontend" / "build"

# Application version - manually incremented on each release
APP_VERSION = "V3.0 R126"


def _get_build_version() -> str:
    """Returns a unique identifier of the current frontend build.
    Uses the main.js hash from asset-manifest.json (changes every rebuild).
    Falls back to mtime of index.html."""
    try:
        manifest = FRONTEND_BUILD / "asset-manifest.json"
        if manifest.exists():
            with open(manifest) as f:
                data = json.load(f)
            main_js = data.get("files", {}).get("main.js", "")
            if main_js:
                # main.<hash>.js -> hash
                parts = main_js.split("/")[-1].split(".")
                if len(parts) >= 3:
                    return parts[1]
        idx = FRONTEND_BUILD / "index.html"
        if idx.exists():
            return str(int(idx.stat().st_mtime))
    except Exception:
        pass
    return "dev"


@api.get("/system/version")
async def system_version():
    """Public endpoint so any authenticated client can detect updates."""
    return {"build": _get_build_version(), "version": APP_VERSION}


def _get_git_info() -> Dict[str, Any]:
    """Returns current git commit, branch, and remote status."""
    info: Dict[str, Any] = {"installed": False}
    try:
        if not (APP_ROOT / ".git").exists():
            return info
        info["installed"] = True
        info["branch"] = subprocess.check_output(
            ["git", "-C", str(APP_ROOT), "rev-parse", "--abbrev-ref", "HEAD"], text=True, timeout=10
        ).strip()
        info["commit"] = subprocess.check_output(
            ["git", "-C", str(APP_ROOT), "rev-parse", "--short", "HEAD"], text=True, timeout=10
        ).strip()
        info["commit_full"] = subprocess.check_output(
            ["git", "-C", str(APP_ROOT), "rev-parse", "HEAD"], text=True, timeout=10
        ).strip()
        info["last_commit_message"] = subprocess.check_output(
            ["git", "-C", str(APP_ROOT), "log", "-1", "--pretty=%B"], text=True, timeout=10
        ).strip()
        info["last_commit_date"] = subprocess.check_output(
            ["git", "-C", str(APP_ROOT), "log", "-1", "--pretty=%cI"], text=True, timeout=10
        ).strip()
        try:
            subprocess.check_output(
                ["git", "-C", str(APP_ROOT), "fetch", "--quiet"], text=True, timeout=30,
                stderr=subprocess.STDOUT,
            )
            info["fetch_ok"] = True
        except Exception as e:
            info["fetch_ok"] = False
            info["fetch_error"] = str(e)
        try:
            behind = subprocess.check_output(
                ["git", "-C", str(APP_ROOT), "rev-list", "--count", "HEAD..@{u}"],
                text=True, timeout=10, stderr=subprocess.DEVNULL,
            ).strip()
            info["commits_behind"] = int(behind) if behind else 0
            info["has_updates"] = info["commits_behind"] > 0
        except Exception:
            info["commits_behind"] = 0
            info["has_updates"] = False
    except Exception as e:
        info["error"] = str(e)
    return info


async def _run_update_task():
    """Background task that runs git pull + pip install + yarn build + supervisor restart."""
    def append(line: str):
        _UPDATE_STATE["log"].append({"t": datetime.now(timezone.utc).isoformat(), "line": line})
        if len(_UPDATE_STATE["log"]) > 1000:
            _UPDATE_STATE["log"] = _UPDATE_STATE["log"][-500:]

    async def run_cmd(cmd: str, cwd: Optional[str] = None, timeout: int = 600) -> int:
        append(f"$ {cmd}")
        proc = await asyncio.create_subprocess_shell(
            cmd, cwd=cwd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        try:
            while True:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=timeout)
                if not line: break
                txt = line.decode("utf-8", errors="replace").rstrip()
                if txt: append(txt)
        except asyncio.TimeoutError:
            proc.kill(); append(f"❌ Timeout após {timeout}s"); return 124
        rc = await proc.wait()
        append(f"[exit {rc}]")
        return rc

    _UPDATE_STATE.update({"running": True, "log": [], "started_at": datetime.now(timezone.utc).isoformat(),
                          "finished_at": None, "success": None})
    try:
        append("🚀 Iniciando atualização…")
        if not (APP_ROOT / ".git").exists():
            append(f"❌ {APP_ROOT} não é um repositório Git. Clone via git para habilitar updates.")
            _UPDATE_STATE["success"] = False
            return
        # Pre-flight: check write permissions
        import os as _os
        if not _os.access(str(APP_ROOT), _os.W_OK):
            append(f"❌ Sem permissão de escrita em {APP_ROOT}")
            append(f"   Rode na VPS: sudo chown -R voxyra:voxyra {APP_ROOT}")
            _UPDATE_STATE["success"] = False
            return
        # Pre-flight: check sudo rights for supervisorctl (try common paths)
        sudo_ok = False
        sudoctl_path = None
        for path in ("supervisorctl", "/usr/bin/supervisorctl", "/usr/local/bin/supervisorctl"):
            check = await asyncio.create_subprocess_shell(
                f"sudo -n {path} status CallCenter-backend",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            sout, serr = await check.communicate()
            out_combined = (sout or b"") + (serr or b"")
            if check.returncode == 0 or b"RUNNING" in out_combined or b"STOPPED" in out_combined:
                sudo_ok = True
                sudoctl_path = path
                break
        if not sudo_ok:
            # Discover actual path to show in the hint
            which = await asyncio.create_subprocess_shell(
                "which supervisorctl", stdout=asyncio.subprocess.PIPE
            )
            wout, _ = await which.communicate()
            actual = wout.decode().strip() if wout else "/usr/bin/supervisorctl"
            append("❌ Sem permissão sudo para reiniciar o supervisor.")
            append(f"   Supervisorctl detectado em: {actual}")
            append("   Rode na VPS (uma vez):")
            append("   sudo tee /etc/sudoers.d/CallCenter-webupdate > /dev/null <<'EOF'")
            append(f"   voxyra ALL=(ALL) NOPASSWD: {actual}")
            append(f"   voxyra ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl")
            append(f"   voxyra ALL=(ALL) NOPASSWD: /usr/local/bin/supervisorctl")
            append("   EOF")
            append("   sudo chmod 0440 /etc/sudoers.d/CallCenter-webupdate")
            _UPDATE_STATE["success"] = False
            return
        # Configure git safe.directory (idempotent, no permission needed for user config)
        await run_cmd(f"git config --global --add safe.directory {APP_ROOT}", timeout=10)
        # git pull
        rc = await run_cmd(f"git -C {APP_ROOT} pull", timeout=120)
        if rc != 0: _UPDATE_STATE["success"] = False; return
        # pip install
        rc = await run_cmd(
            f"bash -c 'cd {APP_ROOT}/backend && source venv/bin/activate && "
            f"grep -vE \"^(emergentintegrations)\" requirements.txt > /tmp/req.txt && "
            f"pip install -r /tmp/req.txt --quiet --disable-pip-version-check'",
            timeout=600,
        )
        if rc != 0: _UPDATE_STATE["success"] = False; return
        # yarn install in place (doesn't affect the running frontend)
        rc = await run_cmd(f"cd {APP_ROOT}/frontend && yarn install --silent", timeout=600)
        if rc != 0: _UPDATE_STATE["success"] = False; return
        # ATOMIC BUILD: build to temporary BUILD_DIR then swap
        # This prevents the user's browser from seeing a partial/deleted build/ folder
        build_old = APP_ROOT / "frontend" / "build"
        build_new = APP_ROOT / "frontend" / "build.new"
        build_backup = APP_ROOT / "frontend" / "build.old"
        append("🏗️  Fazendo build em pasta temporária (build.new)...")
        await run_cmd(f"rm -rf {build_new} {build_backup}", timeout=30)
        rc = await run_cmd(
            f"cd {APP_ROOT}/frontend && BUILD_PATH=./build.new yarn build",
            timeout=900,
        )
        if rc != 0:
            append("❌ Build falhou. O frontend atual permanece intocado.")
            await run_cmd(f"rm -rf {build_new}", timeout=30)
            _UPDATE_STATE["success"] = False; return
        # Validate build.new has index.html and static/js
        if not (build_new / "index.html").exists():
            append("❌ Build gerado está incompleto (sem index.html). Abortando swap.")
            await run_cmd(f"rm -rf {build_new}", timeout=30)
            _UPDATE_STATE["success"] = False; return
        # Atomic swap: mv build -> build.old, mv build.new -> build
        append("🔀 Swap atômico: build.new → build")
        if build_old.exists():
            await run_cmd(f"mv {build_old} {build_backup}", timeout=10)
        await run_cmd(f"mv {build_new} {build_old}", timeout=10)
        # Clean old backup after successful swap
        await run_cmd(f"rm -rf {build_backup}", timeout=30)
        append("")
        append("✅ Código atualizado com sucesso!")
        append("🔄 Reiniciando backend via supervisor…")
        append("   (a página ficará indisponível por ~5 segundos)")
        _UPDATE_STATE["success"] = True
        _UPDATE_STATE["finished_at"] = datetime.now(timezone.utc).isoformat()
        _UPDATE_STATE["running"] = False
        # Schedule restart after 1s so the HTTP response is delivered
        await asyncio.sleep(1)
        restart_cmd = f"sudo -n {sudoctl_path or 'supervisorctl'} restart CallCenter-backend"
        await asyncio.create_subprocess_shell(f"{restart_cmd} &")
    except Exception as e:
        append(f"❌ Erro: {e}")
        _UPDATE_STATE["success"] = False
    finally:
        _UPDATE_STATE["finished_at"] = datetime.now(timezone.utc).isoformat()
        _UPDATE_STATE["running"] = False


@api.get("/system/info")
async def system_info(user: dict = Depends(require_super_admin())):
    """Returns git/version info for the update panel."""
    git = _get_git_info()
    return {
        "app_version": APP_VERSION,
        "app_name": "Voxyra CCA",
        "app_dir": str(APP_ROOT),
        "git": git,
        "update_state": {k: _UPDATE_STATE.get(k) for k in ("running", "started_at", "finished_at", "success")},
    }


@api.get("/system/update/preflight")
async def system_update_preflight(user: dict = Depends(require_super_admin())):
    """Check all permissions/prerequisites needed for web-based update. Returns fix commands."""
    import os as _os, pwd
    checks: List[Dict[str, Any]] = []
    # 1. Git installed?
    r = await asyncio.create_subprocess_shell("git --version", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    await r.communicate()
    checks.append({"name": "Git instalado", "ok": r.returncode == 0, "fix": "sudo apt install -y git"})
    # 2. APP_ROOT é repo git?
    is_git = (APP_ROOT / ".git").exists()
    checks.append({"name": f"{APP_ROOT} é repositório Git", "ok": is_git,
                   "fix": f"Clone via: sudo rm -rf {APP_ROOT} && cd /opt && sudo git clone <URL> {APP_ROOT.name}"})
    # 3. Owner
    try:
        stat = APP_ROOT.stat()
        owner = pwd.getpwuid(stat.st_uid).pw_name
        current_user = pwd.getpwuid(_os.getuid()).pw_name
        checks.append({"name": f"Dono do diretório ({owner}) = usuário do backend ({current_user})",
                       "ok": owner == current_user,
                       "fix": f"sudo chown -R {current_user}:{current_user} {APP_ROOT}"})
    except Exception as e:
        checks.append({"name": "Verificação de dono", "ok": False, "fix": str(e)})
    # 4. Escrita em APP_ROOT
    checks.append({"name": f"Permissão de escrita em {APP_ROOT}",
                   "ok": _os.access(str(APP_ROOT), _os.W_OK),
                   "fix": f"sudo chown -R voxyra:voxyra {APP_ROOT}"})
    # 5. sudoers supervisorctl
    r = await asyncio.create_subprocess_shell(
        "sudo -n supervisorctl status CallCenter-backend 2>&1",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await r.communicate()
    out_txt = out.decode("utf-8", errors="replace") if out else ""
    sudo_ok = r.returncode == 0 or "RUNNING" in out_txt or "STOPPED" in out_txt
    checks.append({
        "name": "Sudo sem senha para supervisorctl",
        "ok": sudo_ok,
        "fix": (
            "sudo tee /etc/sudoers.d/CallCenter-webupdate > /dev/null <<'EOF'\n"
            "voxyra ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl restart CallCenter-backend\n"
            "voxyra ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl reload\n"
            "EOF\n"
            "sudo chmod 0440 /etc/sudoers.d/CallCenter-webupdate"
        ),
    })
    # 6. Git safe.directory
    r = await asyncio.create_subprocess_shell(
        f"git config --global --get-all safe.directory",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    sdo, _ = await r.communicate()
    safe_ok = str(APP_ROOT) in (sdo.decode() if sdo else "")
    checks.append({"name": "git safe.directory configurado", "ok": safe_ok,
                   "fix": f"git config --global --add safe.directory {APP_ROOT}"})
    # 7. yarn
    r = await asyncio.create_subprocess_shell("yarn --version", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    await r.communicate()
    checks.append({"name": "Yarn instalado", "ok": r.returncode == 0, "fix": "sudo npm install -g yarn"})

    all_ok = all(c["ok"] for c in checks)
    return {"all_ok": all_ok, "checks": checks}


@api.post("/system/update/check")
async def system_update_check(user: dict = Depends(require_super_admin())):
    info = _get_git_info()
    if not info.get("installed"):
        raise HTTPException(status_code=400, detail=f"{APP_ROOT} não é um repositório Git.")
    return {"branch": info.get("branch"), "current": info.get("commit"),
            "has_updates": info.get("has_updates", False),
            "commits_behind": info.get("commits_behind", 0),
            "fetch_ok": info.get("fetch_ok", False),
            "fetch_error": info.get("fetch_error")}


@api.post("/system/update/run")
async def system_update_run(user: dict = Depends(require_super_admin())):
    if _UPDATE_STATE.get("running"):
        raise HTTPException(status_code=409, detail="Uma atualização já está em andamento")
    if not (APP_ROOT / ".git").exists():
        raise HTTPException(status_code=400, detail=f"{APP_ROOT} não é um repositório Git. Clone via git para habilitar updates pela web.")
    await write_audit(user, "update", "system", "app", "Atualização via web", {"started_at": datetime.now(timezone.utc).isoformat()})
    asyncio.create_task(_run_update_task())
    return {"ok": True, "message": "Atualização iniciada"}


@api.get("/system/update/status")
async def system_update_status(user: dict = Depends(require_super_admin()), since: int = 0):
    log = _UPDATE_STATE.get("log", [])
    return {
        "running": _UPDATE_STATE.get("running", False),
        "success": _UPDATE_STATE.get("success"),
        "started_at": _UPDATE_STATE.get("started_at"),
        "finished_at": _UPDATE_STATE.get("finished_at"),
        "log": log[since:],
        "total_lines": len(log),
    }


# ---------- FusionPBX Integration ----------


@api.get("/fusionpbx/settings")
async def get_fusion_settings(user: dict = Depends(get_current_user), tenant_id: Optional[str] = None):
    tid = await _resolve_tenant_for_fusion(user, tenant_id)
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")
    s = await db.fusionpbx_settings.find_one({"tenant_id": tid}, {"_id": 0})
    return _serialize_fusion_settings(s)


@api.put("/fusionpbx/settings")
async def put_fusion_settings(body: FusionPBXSettings, user: dict = Depends(get_current_user),
                              tenant_id: Optional[str] = None):
    tid = await _resolve_tenant_for_fusion(user, tenant_id)
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")
    payload = body.dict(exclude_unset=True)
    existing = await db.fusionpbx_settings.find_one({"tenant_id": tid}) or {}
    # Don't overwrite secrets if a masked/empty value was sent and one already exists
    for k in ("api_key", "password"):
        if k in payload and not payload[k]:
            payload[k] = existing.get(k)
    payload["tenant_id"] = tid
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.fusionpbx_settings.update_one({"tenant_id": tid}, {"$set": payload}, upsert=True)
    await write_audit(user, "update", "fusionpbx_settings", tid, "FusionPBX config",
                      {"base_url": payload.get("base_url"), "enabled": payload.get("enabled")})
    s = await db.fusionpbx_settings.find_one({"tenant_id": tid}, {"_id": 0})
    return _serialize_fusion_settings(s)


async def _build_fusion_client(tid: str):
    """Returns either FusionPBXClient (REST) or FusionPBXDBClient based on connection_type."""
    s = await db.fusionpbx_settings.find_one({"tenant_id": tid})
    if not s:
        raise HTTPException(status_code=400, detail="FusionPBX não configurado para este tenant")
    if not s.get("enabled", False):
        raise HTTPException(status_code=400, detail="Integração FusionPBX desativada")
    ctype = s.get("connection_type") or "rest"
    if ctype == "db":
        if not s.get("db_host") or not s.get("db_username"):
            raise HTTPException(status_code=400, detail="Configuração DB incompleta (host/usuário)")
        return FusionPBXDBClient(
            host=s["db_host"], port=int(s.get("db_port") or 5432),
            database=s.get("db_name") or "fusionpbx",
            username=s["db_username"], password=s.get("db_password") or "",
            domain_uuid=s.get("domain_uuid"), ssl=bool(s.get("db_ssl")),
        )
    if not s.get("base_url"):
        raise HTTPException(status_code=400, detail="FusionPBX não configurado para este tenant")
    custom_paths = {k.replace("path_", ""): s[k] for k in
                    ("path_extensions", "path_queues", "path_agents", "path_cdr") if s.get(k)}
    return FusionPBXClient(
        base_url=s["base_url"], api_key=s.get("api_key"),
        username=s.get("username"), password=s.get("password"),
        domain_uuid=s.get("domain_uuid"), domain_name=s.get("domain_name"),
        verify_ssl=bool(s.get("verify_ssl", True)),
        custom_paths=custom_paths,
    )


@api.post("/fusionpbx/test")
async def fusion_test(user: dict = Depends(get_current_user), tenant_id: Optional[str] = None):
    tid = await _resolve_tenant_for_fusion(user, tenant_id)
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")
    s = await db.fusionpbx_settings.find_one({"tenant_id": tid})
    if not s:
        raise HTTPException(status_code=400, detail="Configure a integração primeiro")
    ctype = s.get("connection_type") or "rest"

    if ctype == "db":
        if not s.get("db_host") or not s.get("db_username"):
            raise HTTPException(status_code=400, detail="Configure host e usuário do PostgreSQL")
        # Pré-checagem: TCP reach (firewall/route)
        import socket
        try:
            with socket.create_connection((s["db_host"], int(s.get("db_port") or 5432)), timeout=5):
                tcp_ok = True
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Não consegui abrir TCP em {s['db_host']}:{s.get('db_port', 5432)} → "
                       f"[{type(e).__name__}] {e}. Verifique firewall (iptables/ufw), pg_hba.conf e listen_addresses."
            )
        client = FusionPBXDBClient(
            host=s["db_host"], port=int(s.get("db_port") or 5432),
            database=s.get("db_name") or "fusionpbx",
            username=s["db_username"], password=s.get("db_password") or "",
            domain_uuid=s.get("domain_uuid"), ssl=bool(s.get("db_ssl")),
        )
        try:
            result = await client.ping()
            return {"ok": True, "tcp_reachable": tcp_ok, "mode": "db", **result}
        except FusionPBXDBError as e:
            raise HTTPException(status_code=502, detail=str(e))

    # REST mode
    if not s.get("base_url"):
        raise HTTPException(status_code=400, detail="Configure base_url primeiro")
    client = FusionPBXClient(
        base_url=s["base_url"], api_key=s.get("api_key"),
        username=s.get("username"), password=s.get("password"),
        domain_uuid=s.get("domain_uuid"), domain_name=s.get("domain_name"),
        verify_ssl=bool(s.get("verify_ssl", True)),
    )
    try:
        result = await client.ping()
        return {"ok": True, "mode": "rest", **result}
    except FusionPBXError as e:
        raise HTTPException(status_code=502, detail=str(e))


@api.post("/fusionpbx/clear-demo-data")
async def fusion_clear_demo_data(user: dict = Depends(get_current_user), tenant_id: Optional[str] = None):
    """Deletes all mocked/seeded data (entities without external_id) from the tenant.
    Real data synced from FusionPBX has external_id set, so it stays intact."""
    tid = await _resolve_tenant_for_fusion(user, tenant_id)
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")
    # Delete entities without external_id (= seeded demo data)
    demo_filter = {"tenant_id": tid, "$or": [
        {"external_id": {"$exists": False}}, {"external_id": None}
    ]}
    deleted = {}
    for col in ("agents", "queues", "calls", "recordings"):
        res = await db[col].delete_many(demo_filter)
        deleted[col] = res.deleted_count
    await write_audit(user, "clear", "demo_data", tid, "Limpeza de dados simulados", deleted)
    return {"ok": True, "deleted": deleted, "tenant_id": tid}


@api.post("/fusionpbx/resync-agents")
async def fusion_resync_agents(user: dict = Depends(get_current_user), tenant_id: Optional[str] = None):
    """Wipe all synced agents (real ones from PBX) and re-fetch from FusionPBX.
    Use when the source changed (e.g., switched from extensions to call_center_agents)
    or when agents got renamed in the PBX."""
    tid = await _resolve_tenant_for_fusion(user, tenant_id)
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")
    # Remove apenas agents sincronizados (com external_id)
    res = await db.agents.delete_many({"tenant_id": tid, "external_id": {"$ne": None}})
    deleted_agents = res.deleted_count
    # Roda sync para repopular
    summary = await _run_sync_for_tenant(tid)
    await write_audit(user, "resync", "agents", tid,
                      f"Resincronização de agentes ({deleted_agents} removidos)",
                      {"deleted": deleted_agents, "summary": summary})
    return {"ok": True, "deleted": deleted_agents, "summary": summary}


async def _run_sync_for_tenant(tid: str, cdr_limit: int = 200) -> Dict[str, Any]:
    """Core sync logic reusable by manual endpoint + scheduler."""
    s = await db.fusionpbx_settings.find_one({"tenant_id": tid})
    if not s or not s.get("enabled"):
        return {"skipped": True, "reason": "not_enabled"}
    ctype = s.get("connection_type") or "rest"
    if ctype == "db":
        if not s.get("db_host") or not s.get("db_username"):
            return {"skipped": True, "reason": "db_not_configured"}
        client = FusionPBXDBClient(
            host=s["db_host"], port=int(s.get("db_port") or 5432),
            database=s.get("db_name") or "fusionpbx",
            username=s["db_username"], password=s.get("db_password") or "",
            domain_uuid=s.get("domain_uuid"), ssl=bool(s.get("db_ssl")),
        )
        ClientErr = FusionPBXDBError
    else:
        if not s.get("base_url"):
            return {"skipped": True, "reason": "rest_not_configured"}
        custom_paths = {k.replace("path_", ""): s[k] for k in ("path_extensions", "path_queues", "path_agents", "path_cdr") if s.get(k)}
        client = FusionPBXClient(
            base_url=s["base_url"], api_key=s.get("api_key"),
            username=s.get("username"), password=s.get("password"),
            domain_uuid=s.get("domain_uuid"), domain_name=s.get("domain_name"),
            verify_ssl=bool(s.get("verify_ssl", True)),
            custom_paths=custom_paths,
        )
        ClientErr = FusionPBXError
    summary = {"agents_synced": 0, "queues_synced": 0, "calls_synced": 0,
               "errors": [], "started_at": datetime.now(timezone.utc).isoformat(),
               "agent_source": None}
    # Agents — preferimos call_center_agents (entidade dedicada).
    # Se não houver agentes cadastrados, caímos para extensions (ramais).
    agent_records: list = []
    agent_source = "call_center_agent"
    try:
        cc_agents = await client.list_call_center_agents()
        if cc_agents:
            agent_records = [normalize_agent(a) for a in cc_agents]
        else:
            agent_source = "extension"
            exts = await client.list_extensions()
            agent_records = [normalize_extension(e) for e in exts]
    except ClientErr as e:
        # Se falhar agentes, ainda tenta extensões
        try:
            agent_source = "extension"
            exts = await client.list_extensions()
            agent_records = [normalize_extension(e) for e in exts]
        except ClientErr as e2:
            summary["errors"].append(f"agents: {e} | extensions: {e2}")
    summary["agent_source"] = agent_source
    for ag in agent_records:
        if not ag["external_id"]: continue
        existing = await db.agents.find_one({"tenant_id": tid, "external_id": ag["external_id"]})
        doc = {
            "tenant_id": tid, "external_id": ag["external_id"],
            "name": ag["name"], "username": ag.get("username", ""),
            "extension": ag.get("extension", ""), "email": ag.get("email", ""),
            "source": ag.get("source", "extension"),
            "agent_type": ag.get("agent_type"),
            "avatar": existing.get("avatar") if existing else AGENT_AVATARS[summary["agents_synced"] % len(AGENT_AVATARS)],
            "status": existing.get("status") if existing else "offline",
            "queues": existing.get("queues", []) if existing else [],
            "calls_handled": existing.get("calls_handled", 0) if existing else 0,
            "avg_handle_sec": existing.get("avg_handle_sec", 0) if existing else 0,
            "csat": existing.get("csat", 0) if existing else 0,
            "adherence_pct": existing.get("adherence_pct", 0) if existing else 0,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if existing:
            await db.agents.update_one({"id": existing["id"]}, {"$set": doc})
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = doc["updated_at"]
            await db.agents.insert_one(doc)
        summary["agents_synced"] += 1
    # Queues
    try:
        queues = await client.list_call_center_queues()
        for raw in queues:
            q = normalize_queue(raw)
            if not q["external_id"]: continue
            existing = await db.queues.find_one({"tenant_id": tid, "external_id": q["external_id"]})
            doc = {
                "tenant_id": tid, "external_id": q["external_id"],
                "name": q["name"], "extension": q["extension"],
                "strategy": q["strategy"], "max_wait": q["max_wait"],
                "waiting": existing.get("waiting", 0) if existing else 0,
                "answered_today": existing.get("answered_today", 0) if existing else 0,
                "missed_today": existing.get("missed_today", 0) if existing else 0,
                "avg_wait_sec": existing.get("avg_wait_sec", 0) if existing else 0,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if existing:
                await db.queues.update_one({"id": existing["id"]}, {"$set": doc})
            else:
                doc["id"] = str(uuid.uuid4())
                doc["created_at"] = doc["updated_at"]
                await db.queues.insert_one(doc)
            summary["queues_synced"] += 1
    except ClientErr as e:
        summary["errors"].append(f"queues: {e}")
    # CDR
    try:
        cdrs = await client.list_cdr(limit=cdr_limit)
        # Build multiple lookup keys to match agents from CDR (cc_agent can be: uuid, agent_id, extension)
        agents_db = await db.agents.find(
            {"tenant_id": tid, "external_id": {"$ne": None}}, {"_id": 0}).to_list(2000)
        agent_map = {}
        for a in agents_db:
            if a.get("external_id"): agent_map[a["external_id"]] = a
            if a.get("username"):    agent_map[a["username"]] = a
            if a.get("extension"):   agent_map[a["extension"]] = a
            # FusionPBX uses "agent_id@domain" — also index without domain
            if a.get("username") and "@" not in a["username"] and s.get("domain_name"):
                agent_map[f"{a['username']}@{s['domain_name']}"] = a
        queue_map = {q["external_id"]: q for q in await db.queues.find(
            {"tenant_id": tid, "external_id": {"$ne": None}}, {"_id": 0}).to_list(2000)}
        for raw in cdrs:
            n = normalize_cdr(raw)
            if not n["external_id"]: continue
            existing = await db.calls.find_one({"tenant_id": tid, "external_id": n["external_id"]})
            # try multiple candidates for agent matching
            cc_agent = (n.get("agent_external_id") or "").strip()
            agent = None
            if cc_agent:
                agent = agent_map.get(cc_agent)
                if not agent and "@" in cc_agent:
                    agent = agent_map.get(cc_agent.split("@", 1)[0])
            queue = queue_map.get(n["queue_external_id"]) if n["queue_external_id"] else None
            doc = {
                "tenant_id": tid, "external_id": n["external_id"],
                "agent_id": agent["id"] if agent else None,
                "agent_name": agent["name"] if agent else "—",
                "queue_id": queue["id"] if queue else None,
                "queue_name": queue["name"] if queue else (n["queue_name"] or "—"),
                "direction": n["direction"],
                "caller_number": n["caller_number"], "callee_number": n["callee_number"],
                "disposition": n["disposition"], "abandonment_type": n["abandonment_type"],
                "wait_sec": n["wait_sec"], "duration_sec": n["duration_sec"],
                "started_at": n["started_at"], "ended_at": n["ended_at"],
                "recording_uuid": n.get("recording_uuid"),
            }
            if existing:
                await db.calls.update_one({"id": existing["id"]}, {"$set": doc})
            else:
                doc["id"] = str(uuid.uuid4())
                await db.calls.insert_one(doc)
                if n.get("recording_uuid") and n["disposition"] == "answered":
                    rec_url = await client.get_recording_url(n["recording_uuid"])
                    await db.recordings.insert_one({
                        "id": str(uuid.uuid4()), "tenant_id": tid,
                        "external_id": n["recording_uuid"], "call_id": doc["id"],
                        "agent_id": doc["agent_id"], "agent_name": doc["agent_name"],
                        "queue_id": doc["queue_id"], "queue_name": doc["queue_name"],
                        "caller_number": n["caller_number"],
                        "duration_sec": n["duration_sec"],
                        "audio_url": rec_url, "size_mb": round(n["duration_sec"] * 0.012, 2),
                        "started_at": n["started_at"], "notes": "",
                    })
            summary["calls_synced"] += 1
    except ClientErr as e:
        summary["errors"].append(f"cdr: {e}")
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    summary["status"] = "error" if summary["errors"] and summary["agents_synced"] == 0 else "ok"
    await db.fusionpbx_settings.update_one(
        {"tenant_id": tid},
        {"$set": {"last_sync_at": summary["finished_at"], "last_sync_status": summary["status"],
                  "last_sync_summary": summary}},
    )
    return summary


_SYNC_SCHEDULER_STATE = {"running": False, "last_run": None, "enabled": True}


async def _fusionpbx_scheduler():
    """Background task that syncs all enabled tenants every minute."""
    await asyncio.sleep(30)  # small delay on startup
    while _SYNC_SCHEDULER_STATE["enabled"]:
        try:
            tenants_to_sync = await db.fusionpbx_settings.find(
                {"enabled": True, "$or": [
                    {"connection_type": "db", "db_host": {"$nin": [None, ""]}},
                    {"connection_type": {"$in": [None, "rest"]}, "base_url": {"$nin": [None, ""]}},
                ]},
                {"_id": 0, "tenant_id": 1, "sync_interval_minutes": 1, "last_sync_at": 1},
            ).to_list(1000)
            now = datetime.now(timezone.utc)
            for t in tenants_to_sync:
                tid = t["tenant_id"]
                interval_min = max(1, int(t.get("sync_interval_minutes") or 1))
                last = t.get("last_sync_at")
                if last:
                    try:
                        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                        if (now - last_dt).total_seconds() < interval_min * 60 - 5:
                            continue
                    except Exception:
                        pass
                logger.info("[scheduler] Syncing tenant %s (interval=%dmin)", tid, interval_min)
                try:
                    result = await _run_sync_for_tenant(tid)
                    if not result.get("skipped"):
                        logger.info("[scheduler] Synced %s: %d agents, %d queues, %d calls",
                                    tid, result.get("agents_synced", 0),
                                    result.get("queues_synced", 0), result.get("calls_synced", 0))
                except Exception as e:
                    logger.exception("[scheduler] Erro no tenant %s: %s", tid, e)
            _SYNC_SCHEDULER_STATE["last_run"] = now.isoformat()
        except Exception as e:
            logger.exception("[scheduler] Falha: %s", e)
        await asyncio.sleep(30)  # check every 30s; per-tenant interval gate handles frequency


@api.get("/fusionpbx/scheduler/status")
async def fusion_scheduler_status(user: dict = Depends(get_current_user)):
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")
    enabled_tenants = await db.fusionpbx_settings.count_documents(
        {"enabled": True, "$or": [
            {"connection_type": "db", "db_host": {"$nin": [None, ""]}},
            {"connection_type": {"$in": [None, "rest"]}, "base_url": {"$nin": [None, ""]}},
        ]}
    )
    return {
        "running": _SYNC_SCHEDULER_STATE["running"] or True,  # if backend is up, scheduler is up
        "last_check": _SYNC_SCHEDULER_STATE.get("last_run"),
        "enabled_tenants": enabled_tenants,
    }


@api.get("/fusionpbx/diagnostics")
async def fusion_diagnostics(user: dict = Depends(get_current_user), tenant_id: Optional[str] = None):
    """Returns comprehensive status: settings, last sync, counts of real vs demo data,
    and the latest synced records so the admin can verify data is coming in."""
    tid = await _resolve_tenant_for_fusion(user, tenant_id)
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")

    settings = await db.fusionpbx_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {}

    async def _count_real_vs_demo(col: str) -> Dict[str, int]:
        real = await db[col].count_documents({"tenant_id": tid, "external_id": {"$exists": True, "$ne": None}})
        demo = await db[col].count_documents({"tenant_id": tid, "$or": [{"external_id": {"$exists": False}}, {"external_id": None}]})
        return {"real": real, "demo": demo, "total": real + demo}

    counts = {
        "agents": await _count_real_vs_demo("agents"),
        "queues": await _count_real_vs_demo("queues"),
        "calls": await _count_real_vs_demo("calls"),
        "recordings": await _count_real_vs_demo("recordings"),
    }

    # Last 10 synced calls, 10 agents, 50 queues
    recent_real_calls = await db.calls.find(
        {"tenant_id": tid, "external_id": {"$exists": True, "$ne": None}}, {"_id": 0}
    ).sort("started_at", -1).to_list(10)
    recent_real_agents = await db.agents.find(
        {"tenant_id": tid, "external_id": {"$exists": True, "$ne": None}}, {"_id": 0}
    ).sort("updated_at", -1).to_list(10)
    recent_real_queues = await db.queues.find(
        {"tenant_id": tid, "external_id": {"$exists": True, "$ne": None}}, {"_id": 0}
    ).to_list(50)

    # Audit log of recent syncs
    sync_history = await db.audit_logs.find(
        {"tenant_id": tid, "resource": "fusionpbx", "action": "sync"}, {"_id": 0}
    ).sort("created_at", -1).to_list(5)

    return {
        "tenant_id": tid,
        "settings": {
            "enabled": settings.get("enabled", False),
            "configured": bool(settings.get("base_url")),
            "base_url": settings.get("base_url"),
            "domain_uuid": settings.get("domain_uuid"),
            "domain_name": settings.get("domain_name"),
            "last_sync_at": settings.get("last_sync_at"),
            "last_sync_status": settings.get("last_sync_status"),
            "last_sync_summary": settings.get("last_sync_summary", {}),
        },
        "counts": counts,
        "recent_calls": recent_real_calls,
        "recent_agents": recent_real_agents,
        "recent_queues": recent_real_queues,
        "sync_history": sync_history,
    }



@api.post("/fusionpbx/sync")
async def fusion_sync(user: dict = Depends(get_current_user), tenant_id: Optional[str] = None,
                      cdr_limit: int = 200):
    """Sync manual (chamado pelo botão 'Sincronizar Agora')."""
    tid = await _resolve_tenant_for_fusion(user, tenant_id)
    if user.get("role") not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Sem permissão")
    s = await db.fusionpbx_settings.find_one({"tenant_id": tid})
    if not s or not s.get("base_url"):
        raise HTTPException(status_code=400, detail="FusionPBX não configurado para este tenant")
    if not s.get("enabled", False):
        raise HTTPException(status_code=400, detail="Integração FusionPBX desativada")
    try:
        summary = await _run_sync_for_tenant(tid, cdr_limit=cdr_limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erro na sincronização: {e}")
    await write_audit(user, "sync", "fusionpbx", tid, "Sync FusionPBX",
                      {"agents": summary.get("agents_synced", 0),
                       "queues": summary.get("queues_synced", 0),
                       "calls": summary.get("calls_synced", 0)})
    return summary


# ---------- Seeding ----------
DEMO_AGENTS_A = [("Ana Silva", "ana.silva"), ("Bruno Lima", "bruno.lima"),
                 ("Carla Santos", "carla.santos"), ("Diego Costa", "diego.costa")]
DEMO_AGENTS_B = [("Eliana Rocha", "eliana.rocha"), ("Felipe Souza", "felipe.souza"),
                 ("Gabriela Alves", "gabriela.alves"), ("Henrique Dias", "henrique.dias")]
DEMO_QUEUES_A = [("Vendas", "1001"), ("Suporte Técnico", "1002")]
DEMO_QUEUES_B = [("Financeiro", "1003"), ("Retenção", "1004")]

async def _seed_tenant(tid: str, domain: str, agents_def: list, queues_def: list, n_calls: int = 200):
    queues = []
    for name, ext in queues_def:
        queues.append({
            "id": str(uuid.uuid4()), "tenant_id": tid, "name": name, "extension": ext,
            "strategy": random.choice(["ring-all", "longest-idle", "round-robin"]),
            "max_wait": random.choice([60, 120, 180]),
            "waiting": random.randint(0, 8),
            "answered_today": random.randint(30, 200),
            "missed_today": random.randint(0, 20),
            "avg_wait_sec": random.randint(10, 90),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    await db.queues.insert_many(queues)
    agents = []
    for i, (name, username) in enumerate(agents_def):
        agents.append({
            "id": str(uuid.uuid4()), "tenant_id": tid, "name": name, "username": username,
            "extension": str(1100 + i),
            "email": f"{username}@{domain}",
            "avatar": AGENT_AVATARS[i % len(AGENT_AVATARS)],
            "status": random.choice(STATUSES),
            "queues": random.sample([q["id"] for q in queues], k=min(2, len(queues))),
            "calls_handled": random.randint(20, 180),
            "avg_handle_sec": random.randint(120, 480),
            "csat": round(random.uniform(3.8, 4.9), 2),
            "adherence_pct": round(random.uniform(78, 99), 1),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    await db.agents.insert_many(agents)
    calls = []; recs = []
    for _ in range(n_calls):
        ag = random.choice(agents); q = random.choice(queues)
        started = datetime.now(timezone.utc) - timedelta(
            days=random.randint(0, 27), hours=random.randint(0, 23), minutes=random.randint(0, 59))
        duration = random.randint(30, 900)
        disp = random.choices(DISPOSITIONS, weights=[70, 15, 10, 5])[0]
        ab_type = "agent_loss" if disp == "missed" else "queue_abandon" if disp == "abandoned" else None
        cid = str(uuid.uuid4())
        calls.append({
            "id": cid, "tenant_id": tid,
            "agent_id": ag["id"], "agent_name": ag["name"],
            "queue_id": q["id"], "queue_name": q["name"],
            "direction": random.choice(CALL_DIR),
            "caller_number": f"+55 11 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
            "callee_number": ag["extension"], "disposition": disp,
            "abandonment_type": ab_type,
            "wait_sec": random.randint(5, 120) if disp in ("missed", "abandoned") else random.randint(0, 30),
            "duration_sec": duration if disp == "answered" else random.randint(5, 40),
            "started_at": started.isoformat(),
            "ended_at": (started + timedelta(seconds=duration)).isoformat(),
        })
        if disp == "answered":
            recs.append({
                "id": str(uuid.uuid4()), "tenant_id": tid, "call_id": cid,
                "agent_id": ag["id"], "agent_name": ag["name"],
                "queue_id": q["id"], "queue_name": q["name"],
                "caller_number": calls[-1]["caller_number"],
                "duration_sec": duration, "audio_url": SAMPLE_AUDIO,
                "size_mb": round(duration * 0.012, 2),
                "started_at": started.isoformat(), "notes": "",
            })
    if calls: await db.calls.insert_many(calls)
    if recs: await db.recordings.insert_many(recs)
    # Seed default users for tenant
    users_def = [
        (f"admin@{domain}", "admin123", "Administrador", "admin"),
        (f"supervisor@{domain}", "super123", "Supervisor", "supervisor"),
        (f"agent@{domain}", "agent123", "Agente Demo", "agent"),
    ]
    user_docs = []
    for em, pw, nm, role in users_def:
        user_docs.append({
            "id": str(uuid.uuid4()), "tenant_id": tid, "email": em.lower(),
            "name": nm, "role": role, "password_hash": hash_password(pw),
            "permissions": None, "active": True,
            "agent_id": agents[0]["id"] if role == "agent" else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    await db.users.insert_many(user_docs)

async def seed_data():
    # Super admin
    sa_email = os.environ.get("SUPER_ADMIN_EMAIL", "").lower()
    sa_pw = os.environ.get("SUPER_ADMIN_PASSWORD", "")
    if sa_email and sa_pw:
        existing = await db.users.find_one({"email": sa_email, "role": "super_admin"})
        if not existing:
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "tenant_id": None, "email": sa_email,
                "name": "Super Admin", "role": "super_admin",
                "password_hash": hash_password(sa_pw),
                "permissions": None, "active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        elif not verify_password(sa_pw, existing["password_hash"]):
            await db.users.update_one({"id": existing["id"]}, {"$set": {"password_hash": hash_password(sa_pw)}})

    # Default plans (only seed if none exist)
    if await db.plans.count_documents({}) == 0:
        plans = [
            {"id": str(uuid.uuid4()), "name": "Basic", "description": "Ideal para times pequenos",
             "monthly_price": 99.0, "max_users": 5, "max_agents": 5,
             "features": ["dashboard", "recordings", "reports", "queues_view", "agents_view", "support_email"],
             "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "name": "Pro", "description": "Para operações em crescimento",
             "monthly_price": 299.0, "max_users": 25, "max_agents": 25,
             "features": ["dashboard", "realtime", "recordings", "recordings_download", "recordings_notes",
                          "reports", "reports_export", "queues_view", "queues_edit", "abandoned_analytics",
                          "agents_view", "agents_edit", "agent_scoring", "tv_panel", "audit_logs",
                          "users_management", "support_email"],
             "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "name": "Enterprise", "description": "Sem limites para grandes operações",
             "monthly_price": 799.0, "max_users": 999, "max_agents": 999,
             "features": [f["key"] for f in PLAN_FEATURES_CATALOG],
             "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db.plans.insert_many(plans)

    # Demo tenants
    if os.environ.get("SEED_TENANT_DEMO", "").lower() == "true":
        if await db.tenants.count_documents({}) == 0:
            tA = {
                "id": str(uuid.uuid4()), "domain": "empresa-a.local", "name": "Empresa A",
                "accent_color": "#0EA5E9", "logo_url": None, "timezone": "America/Sao_Paulo",
                "max_users": 50, "max_agents": 50, "active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            tB = {
                "id": str(uuid.uuid4()), "domain": "empresa-b.local", "name": "Empresa B",
                "accent_color": "#10B981", "logo_url": None, "timezone": "America/Sao_Paulo",
                "max_users": 25, "max_agents": 25, "active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.tenants.insert_many([tA, tB])
            await _seed_tenant(tA["id"], tA["domain"], DEMO_AGENTS_A, DEMO_QUEUES_A, n_calls=250)
            await _seed_tenant(tB["id"], tB["domain"], DEMO_AGENTS_B, DEMO_QUEUES_B, n_calls=180)

# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    await db.tenants.create_index("domain", unique=True)
    await db.users.create_index([("tenant_id", 1), ("email", 1)], unique=True)
    await db.agents.create_index([("tenant_id", 1), ("id", 1)])
    await db.queues.create_index([("tenant_id", 1), ("id", 1)])
    await db.calls.create_index([("tenant_id", 1), ("started_at", -1)])
    await db.recordings.create_index([("tenant_id", 1), ("started_at", -1)])
    await db.audit_logs.create_index([("tenant_id", 1), ("created_at", -1)])
    await db.charges.create_index([("tenant_id", 1), ("created_at", -1)])
    await db.charges.create_index("external_id")
    await db.fusionpbx_settings.create_index("tenant_id", unique=True)
    await db.webhook_events.create_index([("source", 1), ("delivery_id", 1)])
    # Start FusionPBX auto-sync scheduler (checks every 30s, syncs per-tenant based on interval)
    asyncio.create_task(_fusionpbx_scheduler())
    logger.info("FusionPBX auto-sync scheduler iniciado")
    await seed_data()

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True, allow_origin_regex=".*",
    allow_methods=["*"], allow_headers=["*"],
)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
