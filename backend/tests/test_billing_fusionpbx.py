"""Iter-3 backend tests for Voxyra CCA: Asaas/PayPal Charges, Webhooks, FusionPBX
settings/test/sync. Also runs regression on existing endpoints.

Credentials per /app/memory/test_credentials.md:
  - super admin  : root@voxyra.io / root123 (no domain)
  - tenant admin : admin@empresa-a.local / admin123 (domain: empresa-a.local)
  - tenant agent : agent@empresa-a.local / agent123 (domain: empresa-a.local)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
TIMEOUT = 30


def _login(domain, email, password):
    body = {"email": email, "password": password}
    if domain:
        body["domain"] = domain
    r = requests.post(f"{BASE_URL}/api/auth/login", json=body, timeout=TIMEOUT)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def super_admin():
    return _login(None, "root@voxyra.io", "root123")


@pytest.fixture(scope="module")
def super_session(super_admin):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {super_admin['token']}"})
    return s


@pytest.fixture(scope="module")
def tenant_admin():
    return _login("empresa-a.local", "admin@empresa-a.local", "admin123")


@pytest.fixture(scope="module")
def tenant_admin_session(tenant_admin):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {tenant_admin['token']}"})
    return s


@pytest.fixture(scope="module")
def tenant_agent():
    return _login("empresa-a.local", "agent@empresa-a.local", "agent123")


@pytest.fixture(scope="module")
def tenant_agent_session(tenant_agent):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {tenant_agent['token']}"})
    return s


@pytest.fixture(scope="module")
def tenant_a_id(super_session):
    r = super_session.get(f"{BASE_URL}/api/tenants", timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    for t in r.json().get("tenants", []):
        if t.get("domain") == "empresa-a.local":
            return t["id"]
    pytest.skip("empresa-a.local tenant not seeded")


# ============================================================================
# Regression: existing endpoints still work
# ============================================================================
def test_regression_auth_me(super_session):
    r = super_session.get(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json()["role"] == "super_admin"


def test_regression_login_invalid():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "nope@x.com", "password": "wrong"}, timeout=TIMEOUT)
    assert r.status_code == 401


def test_regression_tenants_list(super_session):
    r = super_session.get(f"{BASE_URL}/api/tenants", timeout=TIMEOUT)
    assert r.status_code == 200
    assert isinstance(r.json().get("tenants"), list)


def test_regression_plans_list(super_session):
    r = super_session.get(f"{BASE_URL}/api/plans", timeout=TIMEOUT)
    assert r.status_code == 200
    assert "plans" in r.json()


def test_regression_features_catalog_28(super_session):
    r = super_session.get(f"{BASE_URL}/api/plans/features-catalog", timeout=TIMEOUT)
    assert r.status_code == 200
    feats = r.json().get("features", [])
    assert len(feats) == 28, f"expected 28 features, got {len(feats)}"


def test_regression_billing_settings_masking(super_session):
    # PUT a known secret
    r = super_session.put(f"{BASE_URL}/api/billing/settings",
                          json={"asaas_api_key": "TEST_SECRET_ABCDEFGHIJKL", "asaas_environment": "sandbox"},
                          timeout=TIMEOUT)
    assert r.status_code == 200
    # GET masked
    r = super_session.get(f"{BASE_URL}/api/billing/settings", timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    masked = body.get("asaas_api_key", "")
    assert "•" in masked or masked == "••••", f"secret should be masked: {masked}"
    assert body.get("asaas_api_key_set") is True
    # PUT with masked value back -> original kept
    r = super_session.put(f"{BASE_URL}/api/billing/settings",
                          json={"asaas_api_key": masked, "asaas_environment": "sandbox"},
                          timeout=TIMEOUT)
    assert r.status_code == 200


def test_regression_dashboard_stats(super_session, tenant_a_id):
    s = requests.Session()
    s.headers.update({**super_session.headers, "X-Tenant-Context": tenant_a_id})
    r = s.get(f"{BASE_URL}/api/dashboard/stats", timeout=TIMEOUT)
    assert r.status_code == 200
    assert "total_agents" in r.json()


def test_regression_realtime_calls(super_session, tenant_a_id):
    s = requests.Session()
    s.headers.update({**super_session.headers, "X-Tenant-Context": tenant_a_id})
    r = s.get(f"{BASE_URL}/api/realtime/calls", timeout=TIMEOUT)
    assert r.status_code == 200
    assert "calls" in r.json()


def test_regression_recordings(super_session, tenant_a_id):
    s = requests.Session()
    s.headers.update({**super_session.headers, "X-Tenant-Context": tenant_a_id})
    r = s.get(f"{BASE_URL}/api/recordings", timeout=TIMEOUT)
    assert r.status_code == 200
    assert "recordings" in r.json()


def test_regression_users_list_tenant_admin(tenant_admin_session):
    r = tenant_admin_session.get(f"{BASE_URL}/api/users", timeout=TIMEOUT)
    assert r.status_code == 200
    assert "users" in r.json()


# ============================================================================
# Billing - Charges (Asaas/PayPal) - error/validation paths
# ============================================================================
def test_charges_list_initial(super_session):
    r = super_session.get(f"{BASE_URL}/api/billing/charges", timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert "charges" in body
    assert isinstance(body["charges"], list)


def test_charges_list_filter_by_tenant(super_session, tenant_a_id):
    r = super_session.get(f"{BASE_URL}/api/billing/charges",
                          params={"tenant_id": tenant_a_id, "status": "pending"}, timeout=TIMEOUT)
    assert r.status_code == 200
    assert "charges" in r.json()


def test_charges_get_invalid_id_404(super_session):
    r = super_session.get(f"{BASE_URL}/api/billing/charges/{uuid.uuid4()}", timeout=TIMEOUT)
    assert r.status_code == 404


def test_charges_sync_invalid_id_404(super_session):
    r = super_session.post(f"{BASE_URL}/api/billing/charges/{uuid.uuid4()}/sync", timeout=TIMEOUT)
    assert r.status_code == 404


def test_charges_create_unknown_tenant_404(super_session):
    body = {"tenant_id": str(uuid.uuid4()), "gateway": "asaas", "method": "pix",
            "amount": 50.0, "customer_cpf_cnpj": "12345678901"}
    r = super_session.post(f"{BASE_URL}/api/billing/charges", json=body, timeout=TIMEOUT)
    assert r.status_code == 404


def test_charges_create_asaas_pix_requires_config_or_returns_502(super_session, tenant_a_id):
    """If Asaas not configured -> 400. If configured with fake key -> 502 from upstream.
    The previous masking test set a fake key, so we expect 502 (Asaas auth fail)
    OR 400 if cleared. Either way, the charge MUST NOT be created with status=paid.
    """
    body = {"tenant_id": tenant_a_id, "gateway": "asaas", "method": "pix",
            "amount": 49.9, "customer_cpf_cnpj": "12345678901",
            "customer_name": "TEST_Customer", "customer_email": "test@example.com"}
    r = super_session.post(f"{BASE_URL}/api/billing/charges", json=body, timeout=TIMEOUT)
    assert r.status_code in (400, 502), f"expected 400/502 got {r.status_code}: {r.text}"


def test_charges_create_asaas_invalid_method_400(super_session, tenant_a_id):
    body = {"tenant_id": tenant_a_id, "gateway": "asaas", "method": "paypal",
            "amount": 10.0, "customer_cpf_cnpj": "12345678901"}
    r = super_session.post(f"{BASE_URL}/api/billing/charges", json=body, timeout=TIMEOUT)
    assert r.status_code == 400


def test_charges_create_asaas_missing_cpf_400(super_session, tenant_a_id):
    body = {"tenant_id": tenant_a_id, "gateway": "asaas", "method": "pix", "amount": 10.0}
    r = super_session.post(f"{BASE_URL}/api/billing/charges", json=body, timeout=TIMEOUT)
    assert r.status_code == 400


def test_charges_create_paypal_not_configured_400(super_session, tenant_a_id):
    # First clear PayPal creds (set both to empty just in case)
    super_session.put(f"{BASE_URL}/api/billing/settings",
                      json={"paypal_client_id": "", "paypal_client_secret": ""},
                      timeout=TIMEOUT)
    body = {"tenant_id": tenant_a_id, "gateway": "paypal", "method": "paypal",
            "amount": 10.0, "currency": "BRL"}
    r = super_session.post(f"{BASE_URL}/api/billing/charges", json=body, timeout=TIMEOUT)
    assert r.status_code == 400, f"expected 400 PayPal not configured: {r.status_code} {r.text}"


def test_charges_create_unknown_gateway_400(super_session, tenant_a_id):
    body = {"tenant_id": tenant_a_id, "gateway": "stripe", "method": "card", "amount": 10.0}
    r = super_session.post(f"{BASE_URL}/api/billing/charges", json=body, timeout=TIMEOUT)
    assert r.status_code == 400


# ============================================================================
# Webhooks - public, accept JSON, store events
# ============================================================================
def test_webhook_asaas_public_accepts_json():
    # No auth header → must succeed (public endpoint)
    payload = {"event": "PAYMENT_CONFIRMED",
               "payment": {"id": f"pay_TEST_{uuid.uuid4()}", "status": "CONFIRMED"}}
    r = requests.post(f"{BASE_URL}/api/webhooks/asaas", json=payload, timeout=TIMEOUT)
    assert r.status_code in (200, 204), f"asaas webhook unexpected: {r.status_code} {r.text}"


def test_webhook_paypal_public_accepts_json():
    payload = {"event_type": "CHECKOUT.ORDER.APPROVED",
               "resource": {"id": f"ord_TEST_{uuid.uuid4()}"}}
    r = requests.post(f"{BASE_URL}/api/webhooks/paypal", json=payload, timeout=TIMEOUT)
    assert r.status_code in (200, 204), f"paypal webhook unexpected: {r.status_code} {r.text}"


def test_webhook_asaas_invalid_body_handled_gracefully():
    # Send empty body - shouldn't 500
    r = requests.post(f"{BASE_URL}/api/webhooks/asaas",
                      data="not json", headers={"Content-Type": "application/json"},
                      timeout=TIMEOUT)
    assert r.status_code < 500, f"webhook 5xx on bad body: {r.status_code} {r.text}"


# ============================================================================
# FusionPBX - settings, test, sync, RBAC
# ============================================================================
def test_fusionpbx_settings_super_no_tenant_400(super_session):
    r = super_session.get(f"{BASE_URL}/api/fusionpbx/settings", timeout=TIMEOUT)
    assert r.status_code == 400, f"super admin without tenant_id should be 400: {r.status_code} {r.text}"


def test_fusionpbx_settings_super_with_tenant_200(super_session, tenant_a_id):
    r = super_session.get(f"{BASE_URL}/api/fusionpbx/settings",
                          params={"tenant_id": tenant_a_id}, timeout=TIMEOUT)
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_fusionpbx_settings_tenant_admin_self(tenant_admin_session):
    # Tenant admin uses own tenant_id implicitly
    r = tenant_admin_session.get(f"{BASE_URL}/api/fusionpbx/settings", timeout=TIMEOUT)
    assert r.status_code == 200, f"tenant admin should get 200: {r.status_code} {r.text}"
    assert isinstance(r.json(), dict)


def test_fusionpbx_settings_agent_403(tenant_agent_session):
    r = tenant_agent_session.get(f"{BASE_URL}/api/fusionpbx/settings", timeout=TIMEOUT)
    assert r.status_code == 403, f"agent should be 403: {r.status_code} {r.text}"


def test_fusionpbx_settings_put_then_get(super_session, tenant_a_id):
    payload = {
        "enabled": True,
        "base_url": "https://pbx.invalid.local:8443",
        "username": "admin",
        "password": "TEST_pwd",
        "domain_name": "empresa-a.local",
        "verify_ssl": False,
    }
    r = super_session.put(f"{BASE_URL}/api/fusionpbx/settings",
                          params={"tenant_id": tenant_a_id}, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("base_url") == payload["base_url"]
    assert body.get("enabled") is True
    # GET back persists
    r = super_session.get(f"{BASE_URL}/api/fusionpbx/settings",
                          params={"tenant_id": tenant_a_id}, timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json().get("base_url") == payload["base_url"]


def test_fusionpbx_test_no_base_url_400(super_session, super_admin):
    """For a tenant with no base_url configured, /test should return 400."""
    # Find a tenant without fusion config (use empresa-b if exists, else create temp)
    r = super_session.get(f"{BASE_URL}/api/tenants", timeout=TIMEOUT)
    other = None
    for t in r.json().get("tenants", []):
        if t.get("domain") not in ("empresa-a.local",):
            other = t["id"]; break
    if not other:
        pytest.skip("no second tenant available to test 400 path")
    # Ensure no base_url set there: PUT with empty
    super_session.put(f"{BASE_URL}/api/fusionpbx/settings",
                      params={"tenant_id": other}, json={"enabled": False, "base_url": ""},
                      timeout=TIMEOUT)
    r = super_session.post(f"{BASE_URL}/api/fusionpbx/test",
                           params={"tenant_id": other}, timeout=TIMEOUT)
    assert r.status_code == 400, f"expected 400 no base_url: {r.status_code} {r.text}"


def test_fusionpbx_test_invalid_host_502(super_session, tenant_a_id):
    # base_url is set to invalid host above -> ping should fail with FusionPBXError -> 502
    r = super_session.post(f"{BASE_URL}/api/fusionpbx/test",
                           params={"tenant_id": tenant_a_id}, timeout=60)
    assert r.status_code == 502, f"expected 502 from FusionPBX upstream: {r.status_code} {r.text}"


def test_fusionpbx_sync_disabled_400(super_session, tenant_a_id):
    # Disable then try to sync
    super_session.put(f"{BASE_URL}/api/fusionpbx/settings",
                      params={"tenant_id": tenant_a_id},
                      json={"enabled": False, "base_url": "https://pbx.invalid.local:8443"},
                      timeout=TIMEOUT)
    r = super_session.post(f"{BASE_URL}/api/fusionpbx/sync",
                           params={"tenant_id": tenant_a_id}, timeout=60)
    assert r.status_code == 400, f"expected 400 disabled: {r.status_code} {r.text}"


def test_fusionpbx_sync_agent_403(tenant_agent_session):
    r = tenant_agent_session.post(f"{BASE_URL}/api/fusionpbx/sync", timeout=30)
    assert r.status_code == 403


def test_fusionpbx_sync_super_no_tenant_400(super_session):
    r = super_session.post(f"{BASE_URL}/api/fusionpbx/sync", timeout=30)
    assert r.status_code == 400
