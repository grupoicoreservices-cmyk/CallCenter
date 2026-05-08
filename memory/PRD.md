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

### Phase 4 (2026-04 → 2026-05) — Production Deepening
- **FusionPBX via PostgreSQL** (asyncpg) and **FreeSWITCH ESL** (raw asyncio socket) for accurate real-time data.
- **Dedicated login routes**: `/login` (agent), `/master` (admin/supervisor), `/admin` (super admin) with auto domain extraction.
- **Agent Portal `/agent`**: status toggle (Available/Break/Logout) synced to FusionPBX.
- **Advanced Reports**: SLA targets, agent-state log, heatmap, comparative KPIs.
- **SFTP recording streaming** (asyncssh) with HTTP Range support → custom in-app audio player + download.
- **JWT via query string** for native browser tags (`<audio>`, `<a download>`) since they cannot send Authorization headers.
- **Site Branding (Super Admin)** [2026-05-05]: `/branding` page lets root customize login wallpaper, logo, favicon (auto-applied to `<head>`), brand name/subtitle, login title/description, footer text and release version. Backend exposes public `GET /api/branding/site`, super-admin-only `PUT /api/branding/site` and generic `POST /api/uploads/asset?kind=logo|wallpaper|favicon`. Static files served by FastAPI at `/uploads/*`.

## Prioritized Backlog (P0/P1/P2)

### P0
- (none currently)

### P1
- Refactor `server.py` (3500+ lines) into routers (auth, billing, fusionpbx, webhooks, branding)
- Onda 2 — Página Executiva (Top 10 números, taxa de conversão, KPIs estratégicos)
- Onda 4 — Relatórios agendados por email
- PayPal webhook signature verification (PAYPAL-TRANSMISSION-SIG)
- Encrypt secrets at rest (Asaas key, FusionPBX password, SFTP password) instead of plaintext

### P2
- Supervisão silenciosa (spy/whisper/barge) via ESL
- Gravação de tela dos agentes
- CSAT via SMS/URA pós-atendimento
- Subscription model (recurring billing on Asaas)
- AI analysis (Whisper + GPT) for recordings

## Files of Reference
- `/app/backend/server.py` — Main API (3500+ lines, plan to refactor)
- `/app/backend/integrations/{asaas,paypal,fusionpbx,fusionpbx_db,freeswitch_esl,fusionpbx_sftp}.py`
- `/app/frontend/src/pages/{LoginShell,SiteBranding,Charges,FusionPBXSettings,Tenants,Plans,BillingSettings,AgentDashboard,Recordings}.jsx`
- `/app/frontend/src/components/BrandingLoader.jsx` — applies favicon/title globally
- `/app/install.sh` — Self-hosting installer

## Test Credentials
See `/app/memory/test_credentials.md`.

## Changelog (recent)
- 2026-02: Fix — `GET /api/agents` agora exclui ramais por padrão (`include_extensions=False`). Ramais ficam exclusivamente em `/api/extensions`. Mantido parâmetro `?include_extensions=true` para compatibilidade/debug. (server.py list_agents)
- 2026-05-08: **Provisionamento bulk via CSV** — Nova UI em `/provisioning` com botão "Importar CSV" e diálogo de upload. Endpoints: `GET /api/provisioning/devices/template.csv` (download de template) e `POST /api/provisioning/devices/bulk-import` (multipart). Validação all-or-nothing: se qualquer linha tiver MAC duplicado (planilha ou banco), MAC inválido, vendor inválido, ramal inválido ou senha vazia, NENHUM aparelho é importado e a lista completa de erros é retornada por linha. Aceita separador `,` ou `;`, e MAC com `:` `-` ou sem. Rollback automático em caso de falha de geração de arquivo.

