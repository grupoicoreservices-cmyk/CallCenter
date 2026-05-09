#!/usr/bin/env bash
# =====================================================================
# voxyra-fusionpbx-patch.sh
# ---------------------------------------------------------------------
# Aplica os 6 parametros necessarios em /etc/freeswitch/sip_profiles/internal.xml
# para resolver o loop de 401 do Cisco 6921/6941 (firmware SIP 9.4.1)
# em ambientes FusionPBX multi-tenant.
#
# Idempotente: pode ser executado varias vezes sem duplicar os params.
# Faz backup automatico antes de qualquer mudanca.
#
# USO:
#   sudo bash voxyra-fusionpbx-patch.sh [DOMINIO_TENANT] [IP_PUBLICO] [HOSTNAME]
#
# EXEMPLO:
#   sudo bash voxyra-fusionpbx-patch.sh \
#       grupoicore.cliente.voxyra.net.br \
#       51.222.195.17 \
#       callvoxysipbr01.voxyra.net.br
#
# Sem argumentos, ele pergunta interativamente.
# =====================================================================
set -euo pipefail

# ─── Cores ────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[1;33m'; CYN=$'\033[0;36m'; NC=$'\033[0m'

log()  { echo -e "${CYN}[VOXYRA]${NC} $*"; }
ok()   { echo -e "${GRN}[ OK ]${NC} $*"; }
warn() { echo -e "${YLW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR ]${NC} $*" >&2; }

# ─── Pre-checks ───────────────────────────────────────────────────────
if [[ "$(id -u)" -ne 0 ]]; then
  err "Execute com sudo (root): sudo bash $0 ..."
  exit 1
fi

INTERNAL_XML="/etc/freeswitch/sip_profiles/internal.xml"
if [[ ! -f "$INTERNAL_XML" ]]; then
  err "Arquivo nao encontrado: $INTERNAL_XML"
  err "Verifique o caminho do FreeSWITCH na sua instalacao."
  exit 2
fi

if ! command -v fs_cli >/dev/null 2>&1; then
  warn "fs_cli nao encontrado no PATH — apos o patch voce tera que recarregar manualmente."
fi

# ─── Coleta de parametros ─────────────────────────────────────────────
DOMAIN="${1:-}"
PUBIP="${2:-}"
HOSTN="${3:-}"

if [[ -z "$DOMAIN" ]]; then
  read -rp "Dominio do tenant (ex: grupoicore.cliente.voxyra.net.br): " DOMAIN
fi
if [[ -z "$PUBIP" ]]; then
  read -rp "IP publico do FusionPBX (ex: 51.222.195.17): " PUBIP
fi
if [[ -z "$HOSTN" ]]; then
  read -rp "Hostname do servidor (ex: callvoxysipbr01.voxyra.net.br) [enter p/ pular]: " HOSTN
fi

[[ -z "$DOMAIN" || -z "$PUBIP" ]] && { err "DOMAIN e PUBIP sao obrigatorios."; exit 3; }

# Monta lista de aliases sem duplicar
ALIASES="$PUBIP $DOMAIN"
[[ -n "$HOSTN" ]] && ALIASES="$ALIASES $HOSTN"

log "Configuracao:"
echo "  Dominio  : $DOMAIN"
echo "  IP       : $PUBIP"
echo "  Hostname : ${HOSTN:-<nao informado>}"
echo "  Aliases  : $ALIASES"
echo

# ─── Backup ───────────────────────────────────────────────────────────
TS="$(date +%Y%m%d-%H%M%S)"
BKP="${INTERNAL_XML}.bkp.${TS}"
cp -p "$INTERNAL_XML" "$BKP"
ok "Backup criado: $BKP"

# ─── Patch via Python (XML-safe) ──────────────────────────────────────
PYBIN="$(command -v python3 || command -v python || true)"
if [[ -z "$PYBIN" ]]; then
  err "Python3 nao encontrado. Instale: apt install python3"
  exit 4
fi

set +e
"$PYBIN" - "$INTERNAL_XML" "$DOMAIN" "$PUBIP" "$ALIASES" <<'PYEOF'
import sys, re, xml.etree.ElementTree as ET

path, domain, pubip, aliases = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

# Le mantendo comentarios (com regex em paralelo + ElementTree para validar)
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Validacao XML antes de mudar
try:
    ET.fromstring(content)
except ET.ParseError as e:
    print(f"[ERR ] XML atual ja esta com erro de sintaxe: {e}", file=sys.stderr)
    sys.exit(10)

# Os 6 parametros que precisamos
params = {
    "challenge-realm":          "auto_to",
    "force-register-domain":    domain,
    "force-register-db-domain": domain,
    "aliases":                  aliases,
    "multiple-registrations":   "contact",
    "accept-blind-reg":         "false",
}

# Marker para identificar nosso bloco
MARKER_BEGIN = "<!-- VOXYRA-PATCH BEGIN -->"
MARKER_END   = "<!-- VOXYRA-PATCH END -->"

# Remove bloco antigo (re-aplicacao idempotente)
content = re.sub(
    re.escape(MARKER_BEGIN) + r".*?" + re.escape(MARKER_END) + r"\s*",
    "",
    content,
    flags=re.DOTALL,
)

# Para parametros que possam existir SOLTOS fora do nosso marker (config manual antiga),
# vamos comenta-los para nao conflitar com o nosso bloco.
for key in params.keys():
    pattern = rf'(<param\s+name="{re.escape(key)}"[^/]*/>)'
    def comment_out(m):
        line = m.group(1)
        return f"<!-- VOXYRA-PATCH disabled: {line} -->"
    new_content, n = re.subn(pattern, comment_out, content, flags=re.IGNORECASE)
    if n > 0:
        content = new_content

# Monta o bloco novo
patch_lines = [f"    {MARKER_BEGIN}"]
patch_lines.append('    <!-- Adicionado pelo voxyra-fusionpbx-patch.sh -->')
for k, v in params.items():
    patch_lines.append(f'    <param name="{k}" value="{v}"/>')
patch_lines.append(f"    {MARKER_END}")
patch_block = "\n" + "\n".join(patch_lines) + "\n  "

# Insere antes do </settings> do profile internal
# Estrategia: encontra o PRIMEIRO </settings> apos <profile name="internal">
internal_match = re.search(r'<profile\s+name="internal"[^>]*>', content)
if not internal_match:
    print("[ERR ] Profile <profile name=\"internal\"> nao encontrado em internal.xml", file=sys.stderr)
    sys.exit(11)

start = internal_match.end()
close_match = re.search(r'</settings>', content[start:])
if not close_match:
    print("[ERR ] </settings> nao encontrado dentro do profile internal", file=sys.stderr)
    sys.exit(12)

insert_pos = start + close_match.start()
new_content = content[:insert_pos] + patch_block + content[insert_pos:]

# Valida XML resultante
try:
    ET.fromstring(new_content)
except ET.ParseError as e:
    print(f"[ERR ] Patch geraria XML invalido: {e}", file=sys.stderr)
    sys.exit(13)

with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("[ OK ] Patch aplicado com sucesso em", path)
PYEOF

PATCH_RC=$?
set -e
if [[ $PATCH_RC -ne 0 ]]; then
  err "Falha ao aplicar patch (RC=$PATCH_RC). Restaurando backup..."
  cp -p "$BKP" "$INTERNAL_XML"
  err "Backup restaurado. Nada foi alterado."
  exit $PATCH_RC
fi

ok "internal.xml atualizado."

# ─── Reload do profile ────────────────────────────────────────────────
if command -v fs_cli >/dev/null 2>&1; then
  log "Recarregando profile 'internal'..."
  if fs_cli -x "sofia profile internal restart reloadxml" 2>&1 | tee /tmp/voxyra-reload.log; then
    sleep 3
    log "Status do profile:"
    fs_cli -x "sofia status profile internal" | head -15 || true
    echo
    log "Aliases ativos:"
    fs_cli -x "sofia status profile internal" | grep -iE "aliases|domain|challenge-realm" || true
    echo
    ok "Tudo pronto! Faca factory-reset no telefone Cisco e observe o registro."
    echo
    log "Para confirmar registros do ramal apos o reset:"
    echo "    fs_cli -x \"sofia status profile internal reg\" | grep 9168"
  else
    warn "fs_cli falhou ao recarregar. Tente manualmente:"
    echo "    fs_cli -x \"sofia profile internal restart reloadxml\""
  fi
else
  warn "fs_cli indisponivel. Recarregue manualmente quando puder:"
  echo "    sudo systemctl restart freeswitch"
fi

echo
ok "Backup do XML antigo: $BKP"
log "Para reverter em caso de problema:"
echo "    sudo cp $BKP $INTERNAL_XML"
echo "    sudo fs_cli -x \"sofia profile internal restart reloadxml\""
