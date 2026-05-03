"""Asaas payment gateway client (Brazil) - PIX, Boleto, Credit Card."""
from __future__ import annotations
import logging
from typing import Optional, Dict, Any
import httpx

logger = logging.getLogger(__name__)

SANDBOX_URL = "https://api-sandbox.asaas.com/v3"
PRODUCTION_URL = "https://api.asaas.com/v3"


class AsaasError(Exception):
    pass


class AsaasClient:
    def __init__(self, api_key: str, environment: str = "sandbox", user_agent: str = "Voxyra-CCA/1.0"):
        if not api_key:
            raise AsaasError("API key Asaas não configurada")
        self.api_key = api_key
        self.environment = environment
        self.base_url = SANDBOX_URL if environment == "sandbox" else PRODUCTION_URL
        self.user_agent = user_agent
        self.timeout = httpx.Timeout(60.0)

    def _headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "User-Agent": self.user_agent,
            "access_token": self.api_key,
        }

    async def _request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                r = await client.request(method, url, headers=self._headers(), **kwargs)
            except httpx.HTTPError as e:
                raise AsaasError(f"Falha de conexão Asaas: {e}") from e
            if r.status_code >= 400:
                try:
                    body = r.json()
                except Exception:
                    body = {"raw": r.text}
                msg = body.get("errors", body) if isinstance(body, dict) else body
                raise AsaasError(f"Asaas {r.status_code}: {msg}")
            return r.json()

    # Customers
    async def create_customer(self, name: str, cpf_cnpj: str, email: Optional[str] = None,
                              mobile_phone: Optional[str] = None) -> Dict[str, Any]:
        payload = {"name": name, "cpfCnpj": cpf_cnpj}
        if email: payload["email"] = email
        if mobile_phone: payload["mobilePhone"] = mobile_phone
        return await self._request("POST", "/customers", json=payload)

    async def find_customer_by_cpf(self, cpf_cnpj: str) -> Optional[Dict[str, Any]]:
        data = await self._request("GET", "/customers", params={"cpfCnpj": cpf_cnpj})
        items = data.get("data", []) if isinstance(data, dict) else []
        return items[0] if items else None

    # Payments
    async def create_payment(self, customer_id: str, billing_type: str, value: float,
                             due_date: str, description: Optional[str] = None,
                             external_reference: Optional[str] = None) -> Dict[str, Any]:
        """billing_type: PIX | BOLETO | CREDIT_CARD | UNDEFINED. due_date: YYYY-MM-DD"""
        payload = {
            "customer": customer_id,
            "billingType": billing_type,
            "value": float(value),
            "dueDate": due_date,
        }
        if description: payload["description"] = description
        if external_reference: payload["externalReference"] = external_reference
        return await self._request("POST", "/payments", json=payload)

    async def get_payment(self, payment_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/payments/{payment_id}")

    async def get_pix_qrcode(self, payment_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/payments/{payment_id}/pixQrCode")

    async def get_boleto_url(self, payment_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/payments/{payment_id}/identificationField")

    async def cancel_payment(self, payment_id: str) -> Dict[str, Any]:
        return await self._request("DELETE", f"/payments/{payment_id}")


# Status mapping Asaas -> internal
ASAAS_STATUS_TO_INTERNAL = {
    "PENDING": "pending",
    "AWAITING_RISK_ANALYSIS": "pending",
    "CONFIRMED": "confirmed",
    "RECEIVED": "paid",
    "RECEIVED_IN_CASH": "paid",
    "OVERDUE": "overdue",
    "REFUNDED": "refunded",
    "REFUND_REQUESTED": "refunded",
    "CHARGEBACK_REQUESTED": "chargeback",
    "CHARGEBACK_DISPUTE": "chargeback",
    "DELETED": "cancelled",
}


def map_asaas_status(asaas_status: str) -> str:
    return ASAAS_STATUS_TO_INTERNAL.get(asaas_status, "pending")
