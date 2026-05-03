"""PayPal REST API (Checkout Orders v2) client."""
from __future__ import annotations
import base64
import logging
import time
from typing import Optional, Dict, Any
import httpx

logger = logging.getLogger(__name__)

SANDBOX_URL = "https://api-m.sandbox.paypal.com"
LIVE_URL = "https://api-m.paypal.com"


class PayPalError(Exception):
    pass


class PayPalClient:
    def __init__(self, client_id: str, client_secret: str, environment: str = "sandbox"):
        if not client_id or not client_secret:
            raise PayPalError("Client ID/Secret PayPal não configurados")
        self.client_id = client_id
        self.client_secret = client_secret
        self.environment = environment
        self.base_url = SANDBOX_URL if environment == "sandbox" else LIVE_URL
        self._token: Optional[str] = None
        self._token_exp: float = 0.0
        self.timeout = httpx.Timeout(60.0)

    async def _get_token(self) -> str:
        if self._token and time.time() < self._token_exp - 30:
            return self._token
        creds = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/v1/oauth2/token",
                headers={
                    "Authorization": f"Basic {creds}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials"},
            )
            if r.status_code >= 400:
                raise PayPalError(f"PayPal auth failed {r.status_code}: {r.text}")
            data = r.json()
            self._token = data["access_token"]
            self._token_exp = time.time() + data.get("expires_in", 3600)
            return self._token

    async def _request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        token = await self._get_token()
        headers = kwargs.pop("headers", {})
        headers.update({
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                r = await client.request(method, url, headers=headers, **kwargs)
            except httpx.HTTPError as e:
                raise PayPalError(f"Falha de conexão PayPal: {e}") from e
            if r.status_code >= 400:
                raise PayPalError(f"PayPal {r.status_code}: {r.text}")
            if r.status_code == 204:
                return {}
            return r.json()

    async def create_order(self, amount: float, currency: str = "BRL",
                           reference_id: Optional[str] = None,
                           description: Optional[str] = None,
                           return_url: Optional[str] = None,
                           cancel_url: Optional[str] = None) -> Dict[str, Any]:
        unit: Dict[str, Any] = {
            "amount": {"currency_code": currency, "value": f"{float(amount):.2f}"},
        }
        if reference_id: unit["reference_id"] = reference_id
        if description: unit["description"] = description[:127]
        payload: Dict[str, Any] = {
            "intent": "CAPTURE",
            "purchase_units": [unit],
        }
        if return_url or cancel_url:
            payload["application_context"] = {
                "return_url": return_url or "https://example.com/return",
                "cancel_url": cancel_url or "https://example.com/cancel",
                "user_action": "PAY_NOW",
            }
        return await self._request("POST", "/v2/checkout/orders", json=payload)

    async def get_order(self, order_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/v2/checkout/orders/{order_id}")

    async def capture_order(self, order_id: str) -> Dict[str, Any]:
        return await self._request("POST", f"/v2/checkout/orders/{order_id}/capture", json={})


PAYPAL_STATUS_TO_INTERNAL = {
    "CREATED": "pending",
    "SAVED": "pending",
    "APPROVED": "confirmed",
    "VOIDED": "cancelled",
    "COMPLETED": "paid",
    "PAYER_ACTION_REQUIRED": "pending",
    "DECLINED": "failed",
}


def map_paypal_status(status: str) -> str:
    return PAYPAL_STATUS_TO_INTERNAL.get(status, "pending")
