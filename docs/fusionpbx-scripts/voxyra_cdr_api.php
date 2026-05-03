<?php
/**
 * Voxyra CCA - CDR (Call Detail Records) REST API endpoint for FusionPBX
 *
 * INSTALAÇÃO:
 * 1. Copie para: /var/www/fusionpbx/app/xml_cdr/voxyra_cdr_api.php
 * 2. Troque o TOKEN
 * 3. No painel Voxyra, Path CDR: /app/xml_cdr/voxyra_cdr_api.php
 *
 * PARÂMETROS:
 *  ?domain_uuid=<uuid>  (obrigatório)
 *  ?limit=200          (opcional, default 200)
 *  ?start_date=YYYY-MM-DD (opcional)
 *  ?end_date=YYYY-MM-DD   (opcional)
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

$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 200;
if ($limit < 1 || $limit > 1000) $limit = 200;

$where = ["domain_uuid = :d"];
$params = ['d' => $domain_uuid];
if (!empty($_GET['start_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['start_date'])) {
    $where[] = "start_stamp >= :sd";
    $params['sd'] = $_GET['start_date'] . ' 00:00:00';
}
if (!empty($_GET['end_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['end_date'])) {
    $where[] = "start_stamp <= :ed";
    $params['ed'] = $_GET['end_date'] . ' 23:59:59';
}

try {
    $db = new database();
    $db->connect();
    $sql = "SELECT
              xml_cdr_uuid,
              direction,
              caller_id_number,
              caller_id_name,
              destination_number,
              start_stamp,
              end_stamp,
              duration,
              billsec,
              hangup_cause,
              cc_queue,
              cc_agent,
              record_name
            FROM v_xml_cdr
            WHERE " . implode(' AND ', $where) . "
            ORDER BY start_stamp DESC
            LIMIT " . (int)$limit;
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    // Adiciona queue_uuid consultando separadamente se necessário
    echo json_encode(['data' => $rows, 'count' => count($rows)]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
