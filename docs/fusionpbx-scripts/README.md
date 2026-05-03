# Scripts REST para FusionPBX Personalizado

Se seu FusionPBX **não tem endpoints REST** nativos (erro "Nenhum endpoint REST encontrado"), instale estes 3 scripts no seu servidor FusionPBX:

## 📋 Passo 1 — Enviar arquivos para o servidor FusionPBX

Faça upload (via SCP/SFTP) dos 3 arquivos:

```
voxyra_extensions_api.php  →  /var/www/fusionpbx/app/extensions/voxyra_api.php
voxyra_queues_api.php      →  /var/www/fusionpbx/app/call_center/voxyra_api.php
voxyra_cdr_api.php         →  /var/www/fusionpbx/app/xml_cdr/voxyra_api.php
```

## 🔐 Passo 2 — Gerar e configurar um token

No servidor FusionPBX, gere um token aleatório:

```bash
openssl rand -hex 32
# Exemplo: a3f7b2e1c9d8e5f1a3f7b2e1c9d8e5f1a3f7b2e1c9d8e5f1a3f7b2e1c9d8e5f1
```

Edite cada um dos 3 arquivos PHP e troque:
```php
$EXPECTED_TOKEN = "TROCAR_POR_TOKEN_ALEATORIO";
```
Pelo token gerado:
```php
$EXPECTED_TOKEN = "a3f7b2e1c9d8e5f1a3f7b2e1c9d8e5f1a3f7b2e1c9d8e5f1a3f7b2e1c9d8e5f1";
```

## 🧪 Passo 3 — Testar via curl

Descubra seu `domain_uuid` na tabela `v_domains` do PostgreSQL do FusionPBX:

```bash
sudo -u postgres psql -d fusionpbx -c "SELECT domain_uuid, domain_name FROM v_domains;"
```

Teste:

```bash
TOKEN="seu_token_aqui"
DOMAIN_UUID="uuid_do_seu_tenant"
PBX_URL="https://seu-pbx.com.br"

curl -H "Authorization: Bearer $TOKEN" \
  "$PBX_URL/app/extensions/voxyra_api.php?domain_uuid=$DOMAIN_UUID"
```

Deve retornar um JSON:
```json
{"data":[{"extension_uuid":"...","extension":"1001","effective_caller_id_name":"João Silva"},...],"count":5}
```

## 🎯 Passo 4 — Configurar no painel Voxyra CCA

1. Login como super admin
2. Tenants → **Acessar** o tenant
3. Central PBX → aba **Configuração**
4. Preencha:
   - **URL Base do servidor:** `https://seu-pbx.com.br`
   - **API Key:** o token gerado
   - **Domain UUID:** do FusionPBX
   - **Habilitada:** Sim
5. Role até **Endpoints REST customizados** (caixa amarela) e preencha:
   - **Path Extensions:** `/app/extensions/voxyra_api.php`
   - **Path Queues:** `/app/call_center/voxyra_api.php`
   - **Path CDR:** `/app/xml_cdr/voxyra_api.php`
   - **Path Agents:** deixar em branco (usa extensions)
6. **Salvar** → **Testar Conexão** → **Sincronizar Agora**

## ✅ Resultado esperado

- Tab **Diagnóstico** deve mostrar: `✅ Recebendo dados da Central PBX`
- Contadores de Agentes/Filas/Chamadas > 0
- Tabelas populadas com ramais, filas e chamadas reais

## 🔒 Segurança

- **NUNCA** commite o `$EXPECTED_TOKEN` real no Git
- Use um token **diferente** por cliente/tenant se quiser isolamento máximo
- Considere proteger os paths via `.htaccess` com IP whitelist se a URL for pública
- Habilite HTTPS no FusionPBX (Let's Encrypt)

## 🐛 Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| 401 Unauthorized | Token inválido | Verifique se API Key no Voxyra = `$EXPECTED_TOKEN` no PHP |
| 400 domain_uuid inválido | UUID errado | Busque em `SELECT domain_uuid FROM v_domains;` |
| 500 error | Erro no SQL | Veja `/var/log/nginx/error.log` no servidor PBX |
| Dados vazios | SQL retornou 0 rows | Verifique `domain_uuid` e se os ramais estão `enabled='true'` |
| `Nenhum endpoint REST de extensions` | PHP não foi salvo ou path errado | Confira via curl direto no servidor |

## 🗄️ Alternativa: conexão direta PostgreSQL

Se preferir pular os scripts PHP, posso implementar conexão direta ao PostgreSQL do FusionPBX (mais robusto, sem web server no meio). Basta me pedir! 🚀
