# FusionCC — Callcenter Manager (PRD)

## Problem Statement (original)
> Utilizo fusion PBX e gostaria de criar uma frontend para gerenciar o callcenter com opção de ver gravação e analisar agentes.

## Architecture
- **Backend**: FastAPI + Motor + MongoDB, JWT auth (cookie + Bearer) under `/api`
- **Frontend**: React 19 + React Router + Tailwind + Shadcn UI + Recharts + lucide-react, pt-BR
- **Data**: Mock/seeded FusionPBX data (3 users, 4 filas, 8 agentes, 80 chamadas, ~56 gravações)

## User Personas
- **Admin**: full access (CRUD users, manage queues/agents, listen to recordings, edit notes)
- **Supervisor**: monitor real-time, analyze recordings, view reports, edit recording notes
- **Agent**: view own profile/metrics

## Core Requirements (static)
1. Login com roles (admin/supervisor/agent) — JWT
2. Dashboard em tempo real com KPIs
3. Monitor de chamadas ao vivo
4. Gravações: listar, filtrar, reproduzir (player sticky), baixar
5. Relatórios de performance dos agentes
6. Gerenciamento de filas e agentes

## What's been Implemented (2026-02)
- JWT auth (login/logout/me) + seed de 3 usuários
- 8 endpoints REST: dashboard/stats, realtime/calls, agents, agents/{id}, queues, recordings (+filtros), recordings/{id}, reports/agents
- 6 páginas completas: Dashboard, Tempo Real, Gravações (com audio player sticky), Relatórios (chart + ranking), Filas (cards), Agentes (grid + busca)
- Sidebar escura + layout responsivo
- Seed idempotente de agentes, filas, chamadas, gravações
- data-testid em todos elementos interativos
- Testing agent: 12/12 backend + frontend 100%

## Prioritized Backlog (P0/P1/P2)

### P0 (próxima iteração crítica)
- Conexão real com FusionPBX (API/ESL/DB) em vez de mock
- Rate limiting + brute-force lockout no login

### P1
- Análise por IA (transcrição Whisper + sentimento GPT) para gravações
- Exportar relatórios (CSV / PDF)
- Notificações em tempo real (WebSocket) em vez de polling
- Filtro por data range em gravações/relatórios
- Página de configuração de filas (criar/editar/excluir)
- Edição inline de notas das gravações (endpoint já existe)

### P2
- Supervisão silenciosa (spy/whisper/barge) via ESL
- Gravação de tela dos agentes
- CSAT via SMS/URA pós-atendimento
- Multi-tenant / múltiplos PBX

## Next Tasks
1. Pedir ao usuário credenciais/endpoint do FusionPBX real para iniciar integração
2. Planejar WebSocket para realtime
3. (opcional) Ativar IA Whisper + GPT para análise de conversas
