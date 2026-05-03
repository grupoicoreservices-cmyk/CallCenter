<?php
/**
 * Voxyra CCA - Extensions REST API endpoint for FusionPBX
 *
 * INSTALAÇÃO:
 * 1. Copie este arquivo para: /var/www/fusionpbx/app/extensions/voxyra_api.php
 * 2. Proteja com token: edite a linha TOKEN abaixo com uma string aleatória
 * 3. Teste: curl -H "Authorization: Bearer SEU_TOKEN" https://SEU_PBX/app/extensions/voxyra_api.php?domain_uuid=UUID
 * 4. No painel Voxyra, preencha:
 *    - Path Extensions: /app/extensions/voxyra_api.php
 *    - API Key: SEU_TOKEN
 */

require_once dirname(__DIR__, 2) . "/resources/require.php";
require_once "resources/classes/database.php";

// SEGURANÇA: Troque este token
$EXPECTED_TOKEN = "TROCAR_POR_TOKEN_ALEATORIO";

header('Content-Type: application/json; charset=utf-8');
header('X-Powered-By: Voxyra-CCA-API');

// Validação de token
$auth = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
if (strpos($auth, 'Bearer ') !== 0 || substr($auth, 7) !== $EXPECTED_TOKEN) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$domain_uuid = isset($_GET['domain_uuid']) ? $_GET['domain_uuid'] : '';
if (!preg_match('/^[a-f0-9-]{36}$/i', $domain_uuid)) {
    http_response_code(400);
    echo json_encode(['error' => 'domain_uuid inválido']);
    exit;
}

try {
    $db = new database();
    $db->connect();
    $sql = "SELECT
              extension_uuid,
              extension,
              effective_caller_id_name,
              description,
              mwi_account,
              enabled
            FROM v_extensions
            WHERE domain_uuid = :d
              AND enabled = 'true'
            ORDER BY extension::int";
    $params = ['d' => $domain_uuid];
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(['data' => $rows, 'count' => count($rows)]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
