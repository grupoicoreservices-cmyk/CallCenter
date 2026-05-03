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
            "caller_number": f"+55 11 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
            "direction": random.choice(CALL_DIR), "elapsed_sec": random.randint(15, 900), "status": "incall",
        })
    for _ in range(random.randint(0, 3)):
        q = random.choice(list(queues.values())) if queues else {}
        active.append({
            "id": str(uuid.uuid4()), "agent_name": "—", "agent_extension": "—", "agent_avatar": None,
            "queue_name": q.get("name", "—"),
            "caller_number": f"+55 11 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
            "direction": "inbound", "elapsed_sec": random.randint(5, 60), "status": "ringing",
        })
    return {"calls": active}

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
             "features": ["Dashboard", "Gravações", "Relatórios", "1 fila"],
             "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "name": "Pro", "description": "Para operações em crescimento",
             "monthly_price": 299.0, "max_users": 25, "max_agents": 25,
             "features": ["Tudo do Basic", "5 filas", "Painel TV", "Exportação de relatórios", "Análise de abandonos"],
             "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "name": "Enterprise", "description": "Sem limites para grandes operações",
             "monthly_price": 799.0, "max_users": 999, "max_agents": 999,
             "features": ["Tudo do Pro", "Filas ilimitadas", "Suporte prioritário", "SLA dedicado", "White-label"],
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
