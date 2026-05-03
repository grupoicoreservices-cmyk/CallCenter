# Integração com FusionPBX-API (Adrian Fretwell)

Se você usa o **FusionPBX-API** por Adrian Fretwell ([github.com/a2es/FusionPBX-API](https://github.com/a2es/FusionPBX-API) ou similar), o Voxyra CCA **já detecta automaticamente** esse dialeto.

## ⚙️ Pré-requisitos

1. Os apps `api` e `rest_api` devem estar instalados em `/var/www/fusionpbx/app/api/` e `/var/www/fusionpbx/app/rest_api/`
2. Advanced → Upgrade → App Defaults + Schema executados
3. Permissões `restapi_r`, `restapi_c`, `restapi_u`, `restapi_d` ativas para o grupo de admins
4. Regras de rewrite do Nginx configuradas (geralmente já incluídas no install padrão do FusionPBX)

## 📝 Passo 1 — Cadastrar as 3 APIs customizadas no FusionPBX

### Opção A (Mais Rápida): via SQL direto

Conecte no PostgreSQL do FusionPBX e rode:

```sql
-- 1. API para listar ramais (extensions)
INSERT INTO v_restapi (restapi_uuid, domain_uuid, api_name, api_category, api_method, api_uri, api_sql, api_enabled, api_description)
VALUES (
  gen_random_uuid(), NULL,
  'Voxyra Extensions', 'Voxyra', 'GET', 'extensions',
  'SELECT extension_uuid, extension, effective_caller_id_name, description, mwi_account, enabled
   FROM v_extensions
   WHERE domain_uuid = :domain_uuid AND enabled = ''true''
   ORDER BY extension::int',
  'true', 'Voxyra CCA: listar ramais'
);

-- 2. API para listar filas (call_center_queues)
INSERT INTO v_restapi (restapi_uuid, domain_uuid, api_name, api_category, api_method, api_uri, api_sql, api_enabled, api_description)
VALUES (
  gen_random_uuid(), NULL,
  'Voxyra Queues', 'Voxyra', 'GET', 'call_center_queues',
  'SELECT call_center_queue_uuid, queue_name, queue_extension, queue_strategy, queue_max_wait_time
   FROM v_call_center_queues
   WHERE domain_uuid = :domain_uuid AND queue_enabled = ''true''
   ORDER BY queue_extension',
  'true', 'Voxyra CCA: listar filas'
);

-- 3. API para listar CDR (últimas 200 chamadas)
INSERT INTO v_restapi (restapi_uuid, domain_uuid, api_name, api_category, api_method, api_uri, api_sql, api_enabled, api_description)
VALUES (
  gen_random_uuid(), NULL,
  'Voxyra CDR', 'Voxyra', 'GET', 'xml_cdr',
  'SELECT xml_cdr_uuid, direction, caller_id_number, caller_id_name, destination_number,
          start_stamp, end_stamp, duration, billsec, hangup_cause, cc_queue, cc_agent, record_name
   FROM v_xml_cdr
   WHERE domain_uuid = :domain_uuid
   ORDER BY start_stamp DESC
   LIMIT 200',
  'true', 'Voxyra CCA: listar CDR'
);
```

### Opção B: via interface web do FusionPBX

1. Login no FusionPBX como admin
2. Advanced → Rest API
3. Botão **+** (adicionar) 3 vezes, preenchendo os mesmos dados acima

## 🔑 Passo 2 — Gerar a API Key

1. No FusionPBX, menu do usuário (canto superior direito) → **User Settings** (ou **Configurações do Usuário**)
2. Aba **API Keys** → **+ Add**
3. Copie o UUID gerado (formato: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

## ✅ Passo 3 — Testar via curl

Antes de configurar no Voxyra, confirme que as 3 APIs respondem:

```bash
API_KEY="uuid-da-sua-api-key"  # o UUID gerado no passo 2
PBX_URL="https://seu-pbx.com.br"

# Testar ramais
curl "$PBX_URL/app/api/extensions/api-key{$API_KEY}"

# Testar filas
curl "$PBX_URL/app/api/call_center_queues/api-key{$API_KEY}"

# Testar CDR
curl "$PBX_URL/app/api/xml_cdr/api-key{$API_KEY}"
```

Cada chamada deve retornar um **array JSON** com os dados.

## 🎯 Passo 4 — Configurar no painel Voxyra CCA

1. Login como **super admin** → Tenants → **Acessar** o tenant da empresa
2. Menu **Central PBX** → aba **Configuração**
3. Preencha:
   - **URL Base do servidor:** `https://seu-pbx.com.br` (sem barra final)
   - **API Key:** cole o UUID (o Voxyra detecta automaticamente que é formato Fretwell)
   - **Domain UUID:** *deixe em branco* (a api-key já define o domínio)
   - **Habilitada:** ✅
4. Na caixa amarela **Endpoints REST customizados**:
   - **Path Extensions:** `/app/api/extensions`
   - **Path Queues:** `/app/api/call_center_queues`
   - **Path CDR:** `/app/api/xml_cdr`
   - **Path Agents:** deixar em branco
5. **Salvar** → **Testar Conexão** → **Sincronizar Agora**

## ✨ Pronto!

O Voxyra CCA vai automaticamente:
- Montar URLs no formato `/app/api/ENDPOINT/api-key{UUID}`
- Fazer GET sem header Authorization (a autenticação vai inline na URL)
- Parsear as respostas JSON

### Abra a aba **Diagnóstico** para ver:
- ✅ "Recebendo dados da Central PBX"
- Contadores atualizados a cada 1 minuto (auto-sync)
- Tabela "Últimas chamadas" populada

## 🐛 Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| **403 Access Denied** | API key sem permissão `restapi_r` | Edite o grupo do usuário e adicione `restapi_r` |
| **404 API not found** | Linha na `v_restapi` não existe ou está desabilitada | Verifique `SELECT * FROM v_restapi WHERE api_name LIKE 'Voxyra%';` |
| **500 error** | SQL inválido ou coluna inexistente | Veja `/var/log/nginx/error.log` no servidor |
| **JSON vazio `[]`** | Filtro retornou 0 linhas | Confira se há ramais `enabled='true'` no domínio |
| **"Nenhum endpoint REST"** | Paths não salvos corretamente no Voxyra | Revise os 3 paths na caixa amarela |

## 🔒 Segurança

- A API Key UUID do FusionPBX é sensível — trate como senha
- Use **HTTPS** (Let's Encrypt) no FusionPBX
- O admin do Voxyra vê a key mascarada após salvar (só quem configura pela primeira vez vê)
