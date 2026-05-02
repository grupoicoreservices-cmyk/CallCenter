"""Backend API tests for CallCenter PBX Manager (iter 2).
Includes: auth, dashboard/abandoned, reports/types, reports/data, reports/export.
"""
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


# ---- CORS preflight (no wildcard+credentials conflict) ----
def test_cors_preflight_login():
    r = requests.options(
        f"{BASE_URL}/api/auth/login",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
        timeout=20,
    )
    assert r.status_code in (200, 204), r.text
    aco = r.headers.get("access-control-allow-origin", "")
    acc = r.headers.get("access-control-allow-credentials", "").lower()
    # Must NOT be the wildcard+credentials conflict
    assert not (aco == "*" and acc == "true"), f"CORS conflict: origin={aco} creds={acc}"


# ---- Dashboard ----
def test_dashboard_stats(session, auth):
    r = session.get(f"{BASE_URL}/api/dashboard/stats", timeout=20)
    assert r.status_code == 200
    d = r.json()
    for k in ["total_agents", "online_agents", "incall_agents", "answered_today",
              "missed_today", "waiting_in_queue", "avg_wait_sec", "hourly"]:
        assert k in d
    assert isinstance(d["hourly"], list) and len(d["hourly"]) == 24


def test_dashboard_abandoned(session, auth):
    r = session.get(f"{BASE_URL}/api/dashboard/abandoned", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ["by_hour", "by_day", "by_week", "totals", "by_queue"]:
        assert k in d, f"missing {k}"
    assert len(d["by_hour"]) == 24
    assert len(d["by_day"]) == 7
    assert len(d["by_week"]) == 4
    # Each bucket must have agent_loss + queue_abandon
    for bucket in d["by_hour"] + d["by_day"] + d["by_week"]:
        assert "agent_loss" in bucket and "queue_abandon" in bucket
    # Totals shape
    for k in ["last_24h", "last_7d", "last_4w"]:
        assert k in d["totals"]
        assert "agent_loss" in d["totals"][k]
        assert "queue_abandon" in d["totals"][k]
    # by_queue items shape
    if d["by_queue"]:
        q0 = d["by_queue"][0]
        assert "queue" in q0 and "agent_loss" in q0 and "queue_abandon" in q0


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


def test_agent_detail(session, auth):
    agents = session.get(f"{BASE_URL}/api/agents", timeout=20).json()["agents"]
    aid = agents[0]["id"]
    r = session.get(f"{BASE_URL}/api/agents/{aid}", timeout=20)
    assert r.status_code == 200
    assert r.json()["agent"]["id"] == aid


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


# ---- Legacy Reports ----
def test_reports_agents_legacy(session, auth):
    r = session.get(f"{BASE_URL}/api/reports/agents", timeout=20)
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert len(rows) == 8


# ---- New Reports endpoints ----
def test_reports_types(session, auth):
    r = session.get(f"{BASE_URL}/api/reports/types", timeout=20)
    assert r.status_code == 200
    types = r.json()["types"]
    assert len(types) == 6
    keys = {t["key"] for t in types}
    assert keys == {"agents", "queues", "calls", "abandoned", "recordings", "hourly"}
    for t in types:
        assert "label" in t and t["label"]


@pytest.mark.parametrize("rtype,expected_min_rows", [
    ("agents", 8),
    ("queues", 4),
    ("calls", 1),
    ("abandoned", 1),
    ("recordings", 1),
    ("hourly", 24),
])
def test_reports_data_each_type(session, auth, rtype, expected_min_rows):
    r = session.get(f"{BASE_URL}/api/reports/data", params={"type": rtype, "period": "7d"}, timeout=30)
    assert r.status_code == 200, f"{rtype} -> {r.status_code} {r.text}"
    d = r.json()
    assert "title" in d and d["title"]
    assert isinstance(d["columns"], list) and len(d["columns"]) >= 2
    for c in d["columns"]:
        assert "key" in c and "label" in c
    assert isinstance(d["rows"], list)
    if rtype == "agents":
        assert len(d["rows"]) == 8
    if rtype == "queues":
        assert len(d["rows"]) == 4
    if rtype == "hourly":
        assert len(d["rows"]) == 24
    if rtype in ("calls", "abandoned", "recordings"):
        # data is seeded; should have rows in 7d window
        assert len(d["rows"]) >= expected_min_rows, f"{rtype} returned {len(d['rows'])} rows"


def test_reports_data_invalid_type(session, auth):
    r = session.get(f"{BASE_URL}/api/reports/data", params={"type": "bogus"}, timeout=20)
    assert r.status_code == 400


def test_reports_data_calls_filter_agent(session, auth):
    agents = session.get(f"{BASE_URL}/api/agents", timeout=20).json()["agents"]
    aid = agents[0]["id"]
    aname = agents[0]["name"]
    r = session.get(f"{BASE_URL}/api/reports/data",
                    params={"type": "calls", "period": "7d", "agent_id": aid}, timeout=30)
    assert r.status_code == 200
    rows = r.json()["rows"]
    if rows:
        assert all(x["agent_name"] == aname for x in rows)


def test_reports_data_calls_filter_queue(session, auth):
    queues = session.get(f"{BASE_URL}/api/queues", timeout=20).json()["queues"]
    qid = queues[0]["id"]
    qname = queues[0]["name"]
    r = session.get(f"{BASE_URL}/api/reports/data",
                    params={"type": "calls", "period": "7d", "queue_id": qid}, timeout=30)
    assert r.status_code == 200
    rows = r.json()["rows"]
    if rows:
        assert all(x["queue_name"] == qname for x in rows)


def test_reports_export_xlsx(session, auth):
    r = session.get(f"{BASE_URL}/api/reports/export",
                    params={"type": "agents", "format": "xlsx", "period": "7d"}, timeout=30)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers.get("content-type", "")
    # xlsx is a zip; signature PK\x03\x04
    assert r.content[:2] == b"PK", "xlsx body missing PK signature"
    assert "attachment" in r.headers.get("content-disposition", "").lower()


def test_reports_export_pdf(session, auth):
    r = session.get(f"{BASE_URL}/api/reports/export",
                    params={"type": "calls", "format": "pdf", "period": "7d"}, timeout=45)
    assert r.status_code == 200
    assert "application/pdf" in r.headers.get("content-type", "")
    assert r.content[:4] == b"%PDF", "PDF body missing %PDF header"


def test_reports_export_invalid_format(session, auth):
    r = session.get(f"{BASE_URL}/api/reports/export",
                    params={"type": "agents", "format": "csv"}, timeout=20)
    assert r.status_code == 400
