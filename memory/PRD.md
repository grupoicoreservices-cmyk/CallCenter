# Voxyra CCA — Callcenter Analytical (PRD)

## Problem Statement (original)
> Utilizo fusion PBX e gostaria de criar uma frontend para gerenciar o callcenter com opção de ver gravação e analisar agentes.

## Architecture
- **Backend**: FastAPI + Motor + MongoDB, JWT auth (cookie + Bearer) under `/api`
- **Frontend**: React 19 + React Router + Tailwind + Shadcn UI + Recharts + lucide-react, pt-BR
- **Multi-Tenancy**: Domain-based login + Super Admin context switching
- **Integrations** (Feb/2026): Asaas, PayPal, FusionPBX REST

## User Personas
- **Super Admin**: cross-tenant (root@voxyra.io); manages tenants, plans, billing, charges
- **Admin**: full access in tenant scope (CRUD users/queues/agents, recordings)
- **Supervisor**: monitor real-time, analyze recordings, view reports
- **Agent**: view own profile/metrics

## What's been Implemented

### Phase 1 (Initial MVP)
- JWT auth + 3 user roles + tenant data isolation
- Dashboard, Realtime monitor, Recordings, Reports (xlsx/pdf export), Queues, Agents
- Audit logs with 28-permission RBAC catalog
- TV Wallboard with themes, rotation, audio alerts

### Phase 2 (Multi-Tenancy + Billing)
- Multi-tenant CRUD via Super Admin (/tenants)
- Plans CRUD with togglable feature flags
- Tenant logo upload (white-label)
- Billing settings UI (Asaas + PayPal credentials)

### Phase 3 (2026-02-XX) — Real Integrations + Self-Hosting
- **Asaas REAL integration**: PIX (with QR base64), Boleto (with linha digitável), Credit Card. Sandbox+Production, customer dedup by CPF/CNPJ.
- **PayPal REAL integration**: OAuth2 token caching, Orders v2 (create + capture), Sandbox+Live.
- **FusionPBX REST integration**: Per-tenant config (URL, API Key/Basic auth, domain_uuid). Auto-discovery of REST endpoints across community variants. Sync extensions→agents, queues, CDR→calls, recordings.
- **Webhooks**: `/api/webhooks/asaas` (token-protected) and `/api/webhooks/paypal` with idempotency (delivery_id dedup) and JSON-error handling (400 on bad body).
- **Charges UI**: `/charges` page with create dialog, PIX QR display, Boleto link, PayPal checkout, sync status.
- **FusionPBX UI**: `/fusionpbx` page per-tenant config + Test Connection + Sync Now.
- **install.sh**: Monolithic Ubuntu installer (Node20, Python3.11, MongoDB7, Nginx+SSL).
- 33 backend tests (97% pass rate).

## Prioritized Backlog (P0/P1/P2)

### P0
- (none currently)

### P1
- Refactor `server.py` (1737 lines) into routers (auth, billing, fusionpbx, webhooks)
- PayPal webhook signature verification (PAYPAL-TRANSMISSION-SIG)
- Encrypt secrets at rest (Asaas key, FusionPBX password) instead of plaintext
- Background scheduler for periodic FusionPBX sync (using sync_interval_minutes)
- WebSocket-based realtime instead of polling
- AI analysis (Whisper + GPT) for recordings

### P2
- Supervisão silenciosa (spy/whisper/barge) via ESL
- Gravação de tela dos agentes
- CSAT via SMS/URA pós-atendimento
- Subscription model (recurring billing on Asaas)

## Files of Reference
- `/app/backend/server.py` — Main API (1737 lines, plan to refactor)
- `/app/backend/integrations/{asaas,paypal,fusionpbx}.py` — 3rd-party clients
- `/app/frontend/src/pages/{Charges,FusionPBXSettings,Tenants,Plans,BillingSettings}.jsx`
- `/app/install.sh` — Self-hosting installer

## Test Credentials
See `/app/memory/test_credentials.md`.
