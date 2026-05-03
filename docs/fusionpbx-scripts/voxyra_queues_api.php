<?php
/**
 * Voxyra CCA - Call Center Queues REST API endpoint for FusionPBX
 *
 * INSTALAÇÃO:
 * 1. Copie para: /var/www/fusionpbx/app/call_center/voxyra_queues_api.php
 * 2. Troque o TOKEN abaixo
 * 3. No painel Voxyra, Path Queues: /app/call_center/voxyra_queues_api.php
 */

require_once dirname(__DIR__, 2) . "/resources/require.php";
require_once "resources/classes/database.php";

$EXPECTED_TOKEN = "TROCAR_POR_TOKEN_ALEATORIO";

header('Content-Type: application/json; charset=utf-8');

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
              call_center_queue_uuid,
              queue_name,
              queue_extension,
              queue_strategy,
              queue_max_wait_time,
              queue_max_wait_time_with_no_agent
            FROM v_call_center_queues
            WHERE domain_uuid = :d
              AND queue_enabled = 'true'
            ORDER BY queue_extension";
    $stmt = $db->prepare($sql);
    $stmt->execute(['d' => $domain_uuid]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(['data' => $rows, 'count' => count($rows)]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
