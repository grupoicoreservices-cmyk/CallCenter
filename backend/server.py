from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import random
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# ---------- DB ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Voxyra CCA - Callcenter Analytical")
api = APIRouter(prefix="/api")

# ---------- Auth helpers ----------
JWT_ALGO = "HS256"

def _secret():
    return os.environ["JWT_SECRET"]

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGO)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGO])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Usuário não encontrado")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

def require_role(*roles):
    async def checker(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Sem permissão")
        return user
    return checker

# ---------- Models ----------
class LoginReq(BaseModel):
    email: EmailStr
    password: str

class RegisterReq(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "agent"

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str

# ---------- Auth Endpoints ----------
def _set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True,
        secure=False, samesite="lax", max_age=8 * 3600, path="/",
    )

@api.post("/auth/register")
async def register(body: RegisterReq, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "email": email, "name": body.name,
        "role": body.role if body.role in ("admin", "supervisor", "agent") else "agent",
        "password_hash": hash_password(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(uid, email, doc["role"])
    _set_auth_cookie(response, token)
    return {"id": uid, "email": email, "name": body.name, "role": doc["role"], "token": token}

@api.post("/auth/login")
async def login(body: LoginReq, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    token = create_access_token(user["id"], user["email"], user["role"])
    _set_auth_cookie(response, token)
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"], "token": token}

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

# ---------- Mock Data Seeding ----------
AGENT_NAMES = [
    ("Ana Silva", "ana.silva"), ("Bruno Lima", "bruno.lima"),
    ("Carla Santos", "carla.santos"), ("Diego Costa", "diego.costa"),
    ("Eliana Rocha", "eliana.rocha"), ("Felipe Souza", "felipe.souza"),
    ("Gabriela Alves", "gabriela.alves"), ("Henrique Dias", "henrique.dias"),
]
QUEUES = [
    ("Vendas", "1001"), ("Suporte Técnico", "1002"),
    ("Financeiro", "1003"), ("Retenção", "1004"),
]
AGENT_AVATARS = [
    "https://images.unsplash.com/photo-1770058428276-7ca3d2f98568?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwyfHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
    "https://images.unsplash.com/photo-1612276529418-52e6ad86ee1d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHw0fHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
    "https://images.unsplash.com/photo-1712744626457-3ffa4ba32c8c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwxfHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
    "https://images.unsplash.com/photo-1685688739798-bce206ab6b42?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwzfHxjYWxsJTIwY2VudGVyJTIwYWdlbnQlMjBwcm9mZXNzaW9uYWwlMjBwb3J0cmFpdCUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3Nzc3NDcwODh8MA&ixlib=rb-4.1.0&q=85",
]
STATUSES = ["online", "incall", "paused", "offline"]
CALL_DIR = ["inbound", "outbound"]
DISPOSITIONS = ["answered", "missed", "abandoned", "voicemail"]
# public-accessible audio sample for mock recording playback
SAMPLE_AUDIO = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"

async def seed_data():
    # Users: admin / supervisor / agent
    defaults = [
        ("ADMIN_EMAIL", "ADMIN_PASSWORD", "Administrador", "admin"),
        ("SUPERVISOR_EMAIL", "SUPERVISOR_PASSWORD", "Supervisor", "supervisor"),
        ("AGENT_EMAIL", "AGENT_PASSWORD", "Agente Demo", "agent"),
    ]
    for em_key, pw_key, name, role in defaults:
        email = os.environ.get(em_key, "").lower()
        pw = os.environ.get(pw_key, "")
        if not email:
            continue
        existing = await db.users.find_one({"email": email})
        new_hash = hash_password(pw)
        if not existing:
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "email": email, "name": name,
                "role": role, "password_hash": new_hash,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        elif not verify_password(pw, existing["password_hash"]):
            await db.users.update_one({"email": email}, {"$set": {"password_hash": new_hash}})

    # Queues
    if await db.queues.count_documents({}) == 0:
        queues = []
        for name, ext in QUEUES:
            queues.append({
                "id": str(uuid.uuid4()), "name": name, "extension": ext,
                "strategy": random.choice(["ring-all", "longest-idle", "round-robin"]),
                "max_wait": random.choice([60, 120, 180]),
                "waiting": random.randint(0, 8),
                "answered_today": random.randint(30, 200),
                "missed_today": random.randint(0, 20),
                "avg_wait_sec": random.randint(10, 90),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        await db.queues.insert_many(queues)

    # Agents
    if await db.agents.count_documents({}) == 0:
        all_queues = await db.queues.find({}, {"_id": 0}).to_list(100)
        agents = []
        for i, (name, username) in enumerate(AGENT_NAMES):
            agents.append({
                "id": str(uuid.uuid4()), "name": name, "username": username,
                "extension": str(1100 + i),
                "email": f"{username}@callcenter.com",
                "avatar": AGENT_AVATARS[i % len(AGENT_AVATARS)],
                "status": random.choice(STATUSES),
                "queues": random.sample([q["id"] for q in all_queues], k=random.randint(1, 3)),
                "calls_handled": random.randint(20, 180),
                "avg_handle_sec": random.randint(120, 480),
                "csat": round(random.uniform(3.8, 4.9), 2),
                "adherence_pct": round(random.uniform(78, 99), 1),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        await db.agents.insert_many(agents)

    # Calls + Recordings
    if await db.calls.count_documents({}) == 0:
        agents = await db.agents.find({}, {"_id": 0}).to_list(100)
        queues = await db.queues.find({}, {"_id": 0}).to_list(100)
        calls, recs = [], []
        for _ in range(400):
            ag = random.choice(agents)
            q = random.choice(queues)
            started = datetime.now(timezone.utc) - timedelta(
                days=random.randint(0, 27), hours=random.randint(0, 23), minutes=random.randint(0, 59)
            )
            duration = random.randint(30, 900)
            disp = random.choices(DISPOSITIONS, weights=[70, 15, 10, 5])[0]
            # abandonment_type: "agent_loss" (agente não atendeu - missed)
            #                   "queue_abandon" (cliente desistiu na fila - abandoned)
            abandonment_type = None
            if disp == "missed":
                abandonment_type = "agent_loss"
            elif disp == "abandoned":
                abandonment_type = "queue_abandon"
            cid = str(uuid.uuid4())
            calls.append({
                "id": cid,
                "agent_id": ag["id"], "agent_name": ag["name"],
                "queue_id": q["id"], "queue_name": q["name"],
                "direction": random.choice(CALL_DIR),
                "caller_number": f"+55 11 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
                "callee_number": ag["extension"],
                "disposition": disp,
                "abandonment_type": abandonment_type,
                "wait_sec": random.randint(5, 120) if disp in ("missed", "abandoned") else random.randint(0, 30),
                "duration_sec": duration if disp == "answered" else random.randint(5, 40),
                "started_at": started.isoformat(),
                "ended_at": (started + timedelta(seconds=duration)).isoformat(),
            })
            if disp == "answered":
                recs.append({
                    "id": str(uuid.uuid4()),
                    "call_id": cid,
                    "agent_id": ag["id"], "agent_name": ag["name"],
                    "queue_id": q["id"], "queue_name": q["name"],
                    "caller_number": calls[-1]["caller_number"],
                    "duration_sec": duration,
                    "audio_url": SAMPLE_AUDIO,
                    "size_mb": round(duration * 0.012, 2),
                    "started_at": started.isoformat(),
                    "notes": "",
                })
        if calls:
            await db.calls.insert_many(calls)
        if recs:
            await db.recordings.insert_many(recs)

# ---------- Dashboard & PBX endpoints ----------
@api.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    total_agents = await db.agents.count_documents({})
    online_agents = await db.agents.count_documents({"status": {"$in": ["online", "incall", "paused"]}})
    incall = await db.agents.count_documents({"status": "incall"})
    # today's calls
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    answered = await db.calls.count_documents({"disposition": "answered", "started_at": {"$gte": today}})
    missed = await db.calls.count_documents({"disposition": {"$in": ["missed", "abandoned"]}, "started_at": {"$gte": today}})
    # avg wait across queues
    queues = await db.queues.find({}, {"_id": 0}).to_list(50)
    waiting = sum(q.get("waiting", 0) for q in queues)
    avg_wait = int(sum(q.get("avg_wait_sec", 0) for q in queues) / max(len(queues), 1))

    # calls by hour (last 24h bucket)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=23)).isoformat()
    calls_cursor = db.calls.find({"started_at": {"$gte": cutoff}}, {"_id": 0, "started_at": 1, "disposition": 1})
    buckets = {h: {"hour": f"{h:02d}h", "answered": 0, "missed": 0} for h in range(24)}
    async for c in calls_cursor:
        try:
            h = datetime.fromisoformat(c["started_at"]).hour
            if c["disposition"] == "answered":
                buckets[h]["answered"] += 1
            elif c["disposition"] in ("missed", "abandoned"):
                buckets[h]["missed"] += 1
        except Exception:
            pass
    hourly = [buckets[h] for h in range(24)]

    return {
        "total_agents": total_agents,
        "online_agents": online_agents,
        "incall_agents": incall,
        "answered_today": answered,
        "missed_today": missed,
        "waiting_in_queue": waiting,
        "avg_wait_sec": avg_wait,
        "hourly": hourly,
    }

@api.get("/dashboard/abandoned")
async def dashboard_abandoned(user: dict = Depends(get_current_user)):
    """Chamadas abandonadas agrupadas por hora (24h), dia (7d) e semana (4 semanas).
    Tipos: agent_loss (perda de agente / missed) vs queue_abandon (cliente desistiu)."""
    now = datetime.now(timezone.utc)

    # Buckets
    hour_buckets = {h: {"label": f"{h:02d}h", "agent_loss": 0, "queue_abandon": 0} for h in range(24)}
    day_buckets = []
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_buckets.append({
            "key": d.isoformat(),
            "label": d.strftime("%a %d/%m"),
            "agent_loss": 0, "queue_abandon": 0,
        })
    week_buckets = []
    for i in range(3, -1, -1):
        # ISO week starting Monday
        day = now - timedelta(days=now.weekday() + 7 * i)
        day = day.replace(hour=0, minute=0, second=0, microsecond=0)
        week_buckets.append({
            "key": day.isoformat(),
            "label": f"Sem {day.strftime('%d/%m')}",
            "agent_loss": 0, "queue_abandon": 0,
        })

    cutoff_hour = (now - timedelta(hours=23)).isoformat()
    cutoff_day = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff_week = (now - timedelta(days=now.weekday() + 7 * 3)).replace(hour=0, minute=0, second=0, microsecond=0)

    earliest = min(cutoff_week, datetime.fromisoformat(cutoff_hour))
    cursor = db.calls.find(
        {
            "disposition": {"$in": ["missed", "abandoned"]},
            "started_at": {"$gte": earliest.isoformat()},
        },
        {"_id": 0, "started_at": 1, "abandonment_type": 1, "queue_name": 1},
    )

    total_hour = {"agent_loss": 0, "queue_abandon": 0}
    total_day = {"agent_loss": 0, "queue_abandon": 0}
    total_week = {"agent_loss": 0, "queue_abandon": 0}
    by_queue = {}

    async for c in cursor:
        try:
            dt = datetime.fromisoformat(c["started_at"])
        except Exception:
            continue
        at = c.get("abandonment_type")
        if at not in ("agent_loss", "queue_abandon"):
            continue

        # Last 24h bucket
        if dt.isoformat() >= cutoff_hour:
            hour_buckets[dt.hour][at] += 1
            total_hour[at] += 1

        # Last 7 days
        day_key = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        if day_key >= cutoff_day:
            for b in day_buckets:
                if b["key"] == day_key.isoformat():
                    b[at] += 1
                    total_day[at] += 1
                    break

        # Last 4 weeks (by ISO week monday)
        week_start = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        if week_start >= cutoff_week:
            for b in week_buckets:
                if b["key"] == week_start.isoformat():
                    b[at] += 1
                    total_week[at] += 1
                    break

        # Breakdown per queue (last 7 days)
        if day_key >= cutoff_day:
            qn = c.get("queue_name", "—")
            if qn not in by_queue:
                by_queue[qn] = {"queue": qn, "agent_loss": 0, "queue_abandon": 0}
            by_queue[qn][at] += 1

    return {
        "by_hour": [hour_buckets[h] for h in range(24)],
        "by_day": day_buckets,
        "by_week": week_buckets,
        "totals": {
            "last_24h": total_hour,
            "last_7d": total_day,
            "last_4w": total_week,
        },
        "by_queue": sorted(by_queue.values(), key=lambda x: x["agent_loss"] + x["queue_abandon"], reverse=True),
    }


@api.get("/realtime/calls")
async def realtime_calls(user: dict = Depends(get_current_user)):
    agents = await db.agents.find({"status": "incall"}, {"_id": 0}).to_list(100)
    # synthesize active calls from incall agents
    queues = {q["id"]: q for q in await db.queues.find({}, {"_id": 0}).to_list(100)}
    active = []
    for a in agents:
        q_id = a["queues"][0] if a.get("queues") else None
        q = queues.get(q_id, {})
        elapsed = random.randint(15, 900)
        active.append({
            "id": str(uuid.uuid4()),
            "agent_name": a["name"],
            "agent_extension": a["extension"],
            "agent_avatar": a.get("avatar"),
            "queue_name": q.get("name", "—"),
            "caller_number": f"+55 11 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
            "direction": random.choice(CALL_DIR),
            "elapsed_sec": elapsed,
            "status": "incall",
        })
    # add a few "ringing"
    for _ in range(random.randint(0, 3)):
        q = random.choice(list(queues.values())) if queues else {}
        active.append({
            "id": str(uuid.uuid4()),
            "agent_name": "—",
            "agent_extension": "—",
            "agent_avatar": None,
            "queue_name": q.get("name", "—"),
            "caller_number": f"+55 11 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
            "direction": "inbound",
            "elapsed_sec": random.randint(5, 60),
            "status": "ringing",
        })
    return {"calls": active}

@api.get("/agents")
async def list_agents(user: dict = Depends(get_current_user)):
    items = await db.agents.find({}, {"_id": 0}).to_list(500)
    return {"agents": items}

@api.get("/agents/{agent_id}")
async def get_agent(agent_id: str, user: dict = Depends(get_current_user)):
    a = await db.agents.find_one({"id": agent_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Agente não encontrado")
    recent = await db.calls.find({"agent_id": agent_id}, {"_id": 0}).sort("started_at", -1).to_list(20)
    return {"agent": a, "recent_calls": recent}

@api.get("/queues")
async def list_queues(user: dict = Depends(get_current_user)):
    items = await db.queues.find({}, {"_id": 0}).to_list(500)
    # attach agent count per queue
    agents = await db.agents.find({}, {"_id": 0, "queues": 1}).to_list(500)
    for q in items:
        q["agent_count"] = sum(1 for a in agents if q["id"] in a.get("queues", []))
    return {"queues": items}

@api.get("/recordings")
async def list_recordings(
    user: dict = Depends(get_current_user),
    agent_id: Optional[str] = Query(None),
    queue_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
):
    q = {}
    if agent_id:
        q["agent_id"] = agent_id
    if queue_id:
        q["queue_id"] = queue_id
    if search:
        q["$or"] = [
            {"caller_number": {"$regex": search, "$options": "i"}},
            {"agent_name": {"$regex": search, "$options": "i"}},
        ]
    items = await db.recordings.find(q, {"_id": 0}).sort("started_at", -1).to_list(limit)
    return {"recordings": items}

@api.get("/recordings/{rec_id}")
async def get_recording(rec_id: str, user: dict = Depends(get_current_user)):
    r = await db.recordings.find_one({"id": rec_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Gravação não encontrada")
    return r

class NoteUpdate(BaseModel):
    notes: str

@api.patch("/recordings/{rec_id}")
async def update_recording(rec_id: str, body: NoteUpdate, user: dict = Depends(require_role("admin", "supervisor"))):
    res = await db.recordings.update_one({"id": rec_id}, {"$set": {"notes": body.notes}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Não encontrada")
    return {"ok": True}

# ---------- Reports helpers ----------
def _period_cutoff(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "7d":
        return now - timedelta(days=7)
    if period == "30d":
        return now - timedelta(days=30)
    return now - timedelta(days=7)

DISPOSITION_LABELS = {
    "answered": "Atendida", "missed": "Perdida",
    "abandoned": "Abandonada", "voicemail": "Correio de Voz",
}
DIRECTION_LABELS = {"inbound": "Entrada", "outbound": "Saída"}
ABANDON_LABELS = {"agent_loss": "Perda de Agente", "queue_abandon": "Cliente na Fila"}

async def _build_report(report_type: str, period: str, agent_id: Optional[str], queue_id: Optional[str]):
    """Return { title, columns: [{key,label}], rows: [...] }"""
    cutoff = _period_cutoff(period).isoformat()

    if report_type == "agents":
        agents = await db.agents.find({}, {"_id": 0}).to_list(500)
        if agent_id:
            agents = [a for a in agents if a["id"] == agent_id]
        rows = []
        for a in agents:
            q = {"agent_id": a["id"], "started_at": {"$gte": cutoff}}
            answered = await db.calls.count_documents({**q, "disposition": "answered"})
            missed = await db.calls.count_documents({**q, "disposition": {"$in": ["missed", "abandoned"]}})
            rows.append({
                "agent_name": a["name"],
                "extension": a["extension"],
                "status": a.get("status"),
                "answered": answered,
                "missed": missed,
                "avg_handle_sec": a.get("avg_handle_sec", 0),
                "csat": a.get("csat", 0),
                "adherence_pct": a.get("adherence_pct", 0),
            })
        rows.sort(key=lambda r: r["answered"], reverse=True)
        return {
            "title": "Performance de Agentes",
            "columns": [
                {"key": "agent_name", "label": "Agente"},
                {"key": "extension", "label": "Ramal"},
                {"key": "status", "label": "Status"},
                {"key": "answered", "label": "Atendidas"},
                {"key": "missed", "label": "Perdidas"},
                {"key": "avg_handle_sec", "label": "TMA (s)"},
                {"key": "csat", "label": "CSAT"},
                {"key": "adherence_pct", "label": "Aderência %"},
            ],
            "rows": rows,
        }

    if report_type == "queues":
        queues = await db.queues.find({}, {"_id": 0}).to_list(500)
        if queue_id:
            queues = [q for q in queues if q["id"] == queue_id]
        rows = []
        for q in queues:
            filt = {"queue_id": q["id"], "started_at": {"$gte": cutoff}}
            answered = await db.calls.count_documents({**filt, "disposition": "answered"})
            missed = await db.calls.count_documents({**filt, "disposition": {"$in": ["missed", "abandoned"]}})
            total = answered + missed
            rows.append({
                "queue_name": q["name"],
                "extension": q["extension"],
                "strategy": q["strategy"],
                "answered": answered,
                "missed": missed,
                "total": total,
                "sla_pct": round((answered / total) * 100, 1) if total else 0.0,
                "avg_wait_sec": q.get("avg_wait_sec", 0),
            })
        rows.sort(key=lambda r: r["total"], reverse=True)
        return {
            "title": "Chamadas por Fila",
            "columns": [
                {"key": "queue_name", "label": "Fila"},
                {"key": "extension", "label": "Ext."},
                {"key": "strategy", "label": "Estratégia"},
                {"key": "answered", "label": "Atendidas"},
                {"key": "missed", "label": "Perdidas"},
                {"key": "total", "label": "Total"},
                {"key": "sla_pct", "label": "SLA %"},
                {"key": "avg_wait_sec", "label": "TME (s)"},
            ],
            "rows": rows,
        }

    if report_type == "calls":
        q = {"started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.calls.find(q, {"_id": 0}).sort("started_at", -1).to_list(2000)
        rows = [{
            "started_at": fmt_br_datetime(d.get("started_at")),
            "agent_name": d.get("agent_name", "—"),
            "queue_name": d.get("queue_name", "—"),
            "direction": DIRECTION_LABELS.get(d.get("direction"), d.get("direction", "—")),
            "caller_number": d.get("caller_number", "—"),
            "disposition": DISPOSITION_LABELS.get(d.get("disposition"), d.get("disposition", "—")),
            "duration_sec": d.get("duration_sec", 0),
            "wait_sec": d.get("wait_sec", 0),
        } for d in docs]
        return {
            "title": "Histórico de Chamadas (CDR)",
            "columns": [
                {"key": "started_at", "label": "Data/Hora"},
                {"key": "agent_name", "label": "Agente"},
                {"key": "queue_name", "label": "Fila"},
                {"key": "direction", "label": "Direção"},
                {"key": "caller_number", "label": "Número"},
                {"key": "disposition", "label": "Status"},
                {"key": "duration_sec", "label": "Duração (s)"},
                {"key": "wait_sec", "label": "Espera (s)"},
            ],
            "rows": rows,
        }

    if report_type == "abandoned":
        q = {"disposition": {"$in": ["missed", "abandoned"]}, "started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.calls.find(q, {"_id": 0}).sort("started_at", -1).to_list(2000)
        rows = [{
            "started_at": fmt_br_datetime(d.get("started_at")),
            "abandonment_type": ABANDON_LABELS.get(d.get("abandonment_type"), "—"),
            "queue_name": d.get("queue_name", "—"),
            "agent_name": d.get("agent_name", "—"),
            "caller_number": d.get("caller_number", "—"),
            "wait_sec": d.get("wait_sec", 0),
        } for d in docs]
        return {
            "title": "Chamadas Abandonadas",
            "columns": [
                {"key": "started_at", "label": "Data/Hora"},
                {"key": "abandonment_type", "label": "Tipo"},
                {"key": "queue_name", "label": "Fila"},
                {"key": "agent_name", "label": "Agente"},
                {"key": "caller_number", "label": "Número"},
                {"key": "wait_sec", "label": "Espera (s)"},
            ],
            "rows": rows,
        }

    if report_type == "recordings":
        q = {"started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.recordings.find(q, {"_id": 0}).sort("started_at", -1).to_list(2000)
        rows = [{
            "started_at": fmt_br_datetime(d.get("started_at")),
            "agent_name": d.get("agent_name", "—"),
            "queue_name": d.get("queue_name", "—"),
            "caller_number": d.get("caller_number", "—"),
            "duration_sec": d.get("duration_sec", 0),
            "size_mb": d.get("size_mb", 0),
        } for d in docs]
        return {
            "title": "Gravações",
            "columns": [
                {"key": "started_at", "label": "Data/Hora"},
                {"key": "agent_name", "label": "Agente"},
                {"key": "queue_name", "label": "Fila"},
                {"key": "caller_number", "label": "Número"},
                {"key": "duration_sec", "label": "Duração (s)"},
                {"key": "size_mb", "label": "Tamanho (MB)"},
            ],
            "rows": rows,
        }

    if report_type == "hourly":
        q = {"started_at": {"$gte": cutoff}}
        if agent_id: q["agent_id"] = agent_id
        if queue_id: q["queue_id"] = queue_id
        docs = await db.calls.find(q, {"_id": 0, "started_at": 1, "disposition": 1}).to_list(5000)
        buckets = {h: {"hour": f"{h:02d}h", "answered": 0, "missed": 0, "total": 0} for h in range(24)}
        for d in docs:
            try:
                h = datetime.fromisoformat(d["started_at"]).hour
                buckets[h]["total"] += 1
                if d["disposition"] == "answered":
                    buckets[h]["answered"] += 1
                elif d["disposition"] in ("missed", "abandoned"):
                    buckets[h]["missed"] += 1
            except Exception:
                pass
        rows = [buckets[h] for h in range(24)]
        return {
            "title": "Produtividade Horária",
            "columns": [
                {"key": "hour", "label": "Hora"},
                {"key": "answered", "label": "Atendidas"},
                {"key": "missed", "label": "Perdidas"},
                {"key": "total", "label": "Total"},
            ],
            "rows": rows,
        }

    raise HTTPException(status_code=400, detail="Tipo de relatório inválido")


def fmt_br_datetime(iso: Optional[str]) -> str:
    if not iso: return "—"
    try:
        d = datetime.fromisoformat(iso)
        return d.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return iso


@api.get("/reports/agents")
async def reports_agents(user: dict = Depends(get_current_user)):
    """Compat: retorna performance de agentes (usado na aba principal)."""
    agents = await db.agents.find({}, {"_id": 0}).to_list(500)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = []
    for a in agents:
        answered = await db.calls.count_documents({
            "agent_id": a["id"], "disposition": "answered", "started_at": {"$gte": cutoff}
        })
        missed = await db.calls.count_documents({
            "agent_id": a["id"], "disposition": {"$in": ["missed", "abandoned"]}, "started_at": {"$gte": cutoff}
        })
        rows.append({
            "agent_id": a["id"], "agent_name": a["name"], "avatar": a.get("avatar"),
            "status": a.get("status"),
            "answered_7d": answered, "missed_7d": missed,
            "avg_handle_sec": a.get("avg_handle_sec", 0),
            "csat": a.get("csat", 0),
            "adherence_pct": a.get("adherence_pct", 0),
            "calls_handled": a.get("calls_handled", 0),
        })
    rows.sort(key=lambda r: r["answered_7d"], reverse=True)
    return {"rows": rows}


@api.get("/reports/types")
async def reports_types(user: dict = Depends(get_current_user)):
    return {
        "types": [
            {"key": "agents", "label": "Performance de Agentes"},
            {"key": "queues", "label": "Chamadas por Fila"},
            {"key": "calls", "label": "Histórico de Chamadas (CDR)"},
            {"key": "abandoned", "label": "Chamadas Abandonadas"},
            {"key": "recordings", "label": "Gravações"},
            {"key": "hourly", "label": "Produtividade Horária"},
        ]
    }


@api.get("/reports/data")
async def reports_data(
    type: str = Query(...),
    period: str = Query("7d"),
    agent_id: Optional[str] = Query(None),
    queue_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    data = await _build_report(type, period, agent_id, queue_id)
    return data


@api.get("/reports/export")
async def reports_export(
    type: str = Query(...),
    format: str = Query("xlsx"),
    period: str = Query("7d"),
    agent_id: Optional[str] = Query(None),
    queue_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    from fastapi.responses import StreamingResponse
    import io

    data = await _build_report(type, period, agent_id, queue_id)
    filename_base = f"{type}_{period}_{datetime.now().strftime('%Y%m%d_%H%M')}"

    if format == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        wb = Workbook()
        ws = wb.active
        ws.title = data["title"][:30]
        ws.append([data["title"]])
        ws["A1"].font = Font(bold=True, size=14)
        ws.append([f"Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}  ·  Período: {period}"])
        ws.append([])
        headers = [c["label"] for c in data["columns"]]
        ws.append(headers)
        header_row = ws.max_row
        for cell in ws[header_row]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="09090B")
            cell.alignment = Alignment(horizontal="left")
        for row in data["rows"]:
            ws.append([row.get(c["key"], "") for c in data["columns"]])
        # auto-width
        for col in ws.columns:
            max_len = max((len(str(c.value)) if c.value is not None else 0) for c in col)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)
        buf = io.BytesIO()
        wb.save(buf); buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'},
        )

    if format == "pdf":
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=20, rightMargin=20, topMargin=25, bottomMargin=20)
        styles = getSampleStyleSheet()
        story = []
        story.append(Paragraph(f"<b>{data['title']}</b>", styles["Title"]))
        story.append(Paragraph(
            f"Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}  ·  Período: {period}",
            styles["Normal"],
        ))
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
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(tbl)
        doc.build(story)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'},
        )

    raise HTTPException(status_code=400, detail="Formato inválido. Use xlsx ou pdf.")

# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.agents.create_index("id", unique=True)
    await db.queues.create_index("id", unique=True)
    await db.calls.create_index("started_at")
    await db.recordings.create_index("started_at")
    await seed_data()

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

# Include router
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
