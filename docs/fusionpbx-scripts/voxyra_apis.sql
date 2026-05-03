-- ============================================================================
-- Voxyra CCA - APIs REST para FusionPBX-API (Adrian Fretwell)
-- ============================================================================
-- Execute este SQL no banco PostgreSQL do FusionPBX UMA VEZ para cadastrar
-- as 3 APIs que o Voxyra CCA consome.
--
-- Como rodar:
--   sudo -u postgres psql -d fusionpbx -f voxyra_apis.sql
--
-- Após rodar, vá em Advanced → Rest API no FusionPBX e confirme que apareceram
-- 3 entradas com categoria "Voxyra".
-- ============================================================================

-- Limpar registros antigos (se já existirem)
DELETE FROM v_restapi WHERE api_category = 'Voxyra';

-- 1. GET /app/api/extensions — lista de ramais
INSERT INTO v_restapi (
    restapi_uuid, domain_uuid, api_name, api_category, api_method, api_uri,
    api_sql, api_enabled, api_description
) VALUES (
    gen_random_uuid(), NULL,
    'Voxyra Extensions', 'Voxyra', 'GET', 'extensions',
    'SELECT extension_uuid, extension, effective_caller_id_name, description, mwi_account, enabled
     FROM v_extensions
     WHERE domain_uuid = :domain_uuid AND enabled = ''true''
     ORDER BY extension::int',
    'true', 'Voxyra CCA: listar ramais'
);

-- 2. GET /app/api/call_center_queues — lista de filas
INSERT INTO v_restapi (
    restapi_uuid, domain_uuid, api_name, api_category, api_method, api_uri,
    api_sql, api_enabled, api_description
) VALUES (
    gen_random_uuid(), NULL,
    'Voxyra Queues', 'Voxyra', 'GET', 'call_center_queues',
    'SELECT call_center_queue_uuid, queue_name, queue_extension, queue_strategy,
            queue_max_wait_time, queue_max_wait_time_with_no_agent
     FROM v_call_center_queues
     WHERE domain_uuid = :domain_uuid AND queue_enabled = ''true''
     ORDER BY queue_extension',
    'true', 'Voxyra CCA: listar filas de call center'
);

-- 3. GET /app/api/xml_cdr — últimas 200 chamadas
INSERT INTO v_restapi (
    restapi_uuid, domain_uuid, api_name, api_category, api_method, api_uri,
    api_sql, api_enabled, api_description
) VALUES (
    gen_random_uuid(), NULL,
    'Voxyra CDR', 'Voxyra', 'GET', 'xml_cdr',
    'SELECT xml_cdr_uuid, direction, caller_id_number, caller_id_name,
            destination_number, start_stamp, end_stamp, duration, billsec,
            hangup_cause, cc_queue, cc_agent, record_name
     FROM v_xml_cdr
     WHERE domain_uuid = :domain_uuid
     ORDER BY start_stamp DESC
     LIMIT 200',
    'true', 'Voxyra CCA: últimas 200 chamadas (CDR)'
);

-- Verificação
SELECT api_name, api_method, api_uri, api_enabled
FROM v_restapi
WHERE api_category = 'Voxyra'
ORDER BY api_name;
