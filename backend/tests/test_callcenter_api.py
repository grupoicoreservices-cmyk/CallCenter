"""Backend API tests for CallCenter PBX Manager."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://fusion-call-desk.preview.emergentagent.com').rstrip('/')
ADMIN = {"email": "admin@callcenter.com", "password": "admin123"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and data["email"] == ADMIN["email"]
    session.headers["Authorization"] = f"Bearer {data['token']}"
    return data


# ---- Auth ----
def test_login_invalid(session):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "x@x.com", "password": "wrong"}, timeout=20)
    assert r.status_code == 401


def test_auth_me(session, auth):
    r = session.get(f"{BASE_URL}/api/auth/me", timeout=20)
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN["email"]


def test_protected_no_token():
    r = requests.get(f"{BASE_URL}/api/dashboard/stats", timeout=20)
    assert r.status_code == 401


# ---- Dashboard ----
def test_dashboard_stats(session, auth):
    r = session.get(f"{BASE_URL}/api/dashboard/stats", timeout=20)
    assert r.status_code == 200
    d = r.json()
    for k in ["total_agents", "online_agents", "incall_agents", "answered_today",
              "missed_today", "waiting_in_queue", "avg_wait_sec", "hourly"]:
        assert k in d
    assert isinstance(d["hourly"], list) and len(d["hourly"]) == 24


# ---- Realtime ----
def test_realtime_calls(session, auth):
    r = session.get(f"{BASE_URL}/api/realtime/calls", timeout=20)
    assert r.status_code == 200
    assert "calls" in r.json()


# ---- Agents ----
def test_list_agents(session, auth):
    r = session.get(f"{BASE_URL}/api/agents", timeout=20)
    assert r.status_code == 200
    agents = r.json()["agents"]
    assert len(agents) == 8
    a = agents[0]
    for k in ["id", "name", "avatar", "csat", "adherence_pct"]:
        assert k in a


def test_agent_detail(session, auth):
    agents = session.get(f"{BASE_URL}/api/agents", timeout=20).json()["agents"]
    aid = agents[0]["id"]
    r = session.get(f"{BASE_URL}/api/agents/{aid}", timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d["agent"]["id"] == aid
    assert "recent_calls" in d


# ---- Queues ----
def test_queues(session, auth):
    r = session.get(f"{BASE_URL}/api/queues", timeout=20)
    assert r.status_code == 200
    qs = r.json()["queues"]
    assert len(qs) == 4
    assert "agent_count" in qs[0]


# ---- Recordings ----
def test_recordings(session, auth):
    r = session.get(f"{BASE_URL}/api/recordings", timeout=20)
    assert r.status_code == 200
    recs = r.json()["recordings"]
    assert len(recs) > 0
    assert recs[0]["audio_url"].startswith("http")


def test_recordings_filter_agent(session, auth):
    recs = session.get(f"{BASE_URL}/api/recordings", timeout=20).json()["recordings"]
    aid = recs[0]["agent_id"]
    r = session.get(f"{BASE_URL}/api/recordings", params={"agent_id": aid}, timeout=20)
    assert r.status_code == 200
    assert all(x["agent_id"] == aid for x in r.json()["recordings"])


def test_recordings_search(session, auth):
    recs = session.get(f"{BASE_URL}/api/recordings", timeout=20).json()["recordings"]
    term = recs[0]["caller_number"][-4:]
    r = session.get(f"{BASE_URL}/api/recordings", params={"search": term}, timeout=20)
    assert r.status_code == 200
    assert len(r.json()["recordings"]) >= 1


# ---- Reports ----
def test_reports_agents(session, auth):
    r = session.get(f"{BASE_URL}/api/reports/agents", timeout=20)
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert len(rows) == 8
    # sorted desc by answered_7d
    vals = [x["answered_7d"] for x in rows]
    assert vals == sorted(vals, reverse=True)
