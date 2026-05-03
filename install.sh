#!/usr/bin/env bash
###############################################################################
# Voxyra CCA - Script de Instalação Automatizada para Ubuntu Server
# Tested on: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS
# Author: Voxyra Labs
#
# Uso:
#   sudo bash install.sh
#
# O que ele faz:
#   1. Instala dependências do sistema (Node.js 20, Python 3.11, MongoDB 7)
#   2. Instala Nginx + Supervisor + Certbot
#   3. Clona/atualiza o código do projeto
#   4. Configura backend (venv + pip install)
#   5. Builda frontend (yarn build)
#   6. Cria configuração do Supervisor para o backend
#   7. Configura Nginx como reverse proxy
#   8. Opcional: Configura SSL com Let's Encrypt
###############################################################################

set -euo pipefail

# -------- Configurações (edite conforme necessário) --------
APP_NAME="CallCenter"
APP_DIR="/opt/${APP_NAME}"
APP_USER="voxyra"
DOMAIN="${DOMAIN:-}"                    # ex: voxyra.empresa.com.br (opcional, p/ SSL)
EMAIL_LE="${EMAIL_LE:-admin@example.com}" # email para Let's Encrypt
GIT_REPO="${GIT_REPO:-}"                # opcional: URL do repo Git
SUPER_ADMIN_EMAIL="${SUPER_ADMIN_EMAIL:-root@voxyra.io}"
SUPER_ADMIN_PASSWORD="${SUPER_ADMIN_PASSWORD:-}"   # se vazio, será gerado
JWT_SECRET="${JWT_SECRET:-}"            # se vazio, será gerado
SEED_DEMO="${SEED_DEMO:-false}"         # true = popula tenants Empresa A/B
MONGO_URL="${MONGO_URL:-mongodb://127.0.0.1:27017}"
DB_NAME="${DB_NAME:-voxyra_cca}"

# -------- Helpers --------
RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLU='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLU}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GRN}✓${NC} $*"; }
warn() { echo -e "${YLW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }
die()  { err "$1"; exit 1; }

# -------- Pré-requisitos --------
[ "$EUID" -eq 0 ] || die "Execute como root (sudo bash install.sh)"
[ -f /etc/os-release ] || die "Sistema não suportado (sem /etc/os-release)"
. /etc/os-release
[ "$ID" = "ubuntu" ] || warn "Distro detectada: $ID. Script foi testado em Ubuntu 22.04+."

# -------- Banner --------
cat <<'BANNER'

   ╦  ╦┌─┐─┐ ┬┬ ┬┬─┐┌─┐  ╔═╗╔═╗╔═╗
   ╚╗╔╝│ │┌┴┬┘└┬┘├┬┘├─┤  ║  ║  ╠═╣
    ╚╝ └─┘┴ └─ ┴ ┴└─┴ ┴  ╚═╝╚═╝╩ ╩
   Callcenter Analytical · Self-host installer

BANNER

# -------- Gerar segredos se não fornecidos --------
[ -z "$JWT_SECRET" ] && JWT_SECRET="$(openssl rand -hex 32)"
[ -z "$SUPER_ADMIN_PASSWORD" ] && SUPER_ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '=+/')"

log "Configurações:"
echo "  APP_DIR             = $APP_DIR"
echo "  DOMAIN              = ${DOMAIN:-<vazio - sem SSL>}"
echo "  MONGO_URL           = $MONGO_URL"
echo "  DB_NAME             = $DB_NAME"
echo "  SUPER_ADMIN_EMAIL   = $SUPER_ADMIN_EMAIL"
echo "  SUPER_ADMIN_PASSWORD= $SUPER_ADMIN_PASSWORD"
echo "  SEED_DEMO           = $SEED_DEMO"
echo

read -p "Continuar? [s/N] " -n 1 -r ANS; echo
[[ $ANS =~ ^[SsYy]$ ]] || die "Cancelado pelo usuário"

# -------- 1. Atualizar sistema e instalar dependências básicas --------
log "Atualizando sistema..."
apt-get update -qq
apt-get install -y -qq curl wget gnupg ca-certificates lsb-release \
                       software-properties-common apt-transport-https \
                       build-essential git supervisor nginx ufw openssl
ok "Pacotes base instalados"

# -------- 2. Node.js 20 --------
if ! command -v node &>/dev/null || [[ "$(node --version | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
    log "Instalando Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
fi
npm install -g yarn --silent
ok "Node $(node --version) · Yarn $(yarn --version)"

# -------- 3. Python 3.12 --------
log "Instalando Python 3.12..."
apt-get install -y python3.12 python3.12-venv python3.12-dev python3-pip
PY_BIN="python3.12"
PY_VERSION=$("$PY_BIN" --version 2>&1)
ok "$PY_VERSION"

# -------- 4. MongoDB 7 --------
if ! systemctl is-active --quiet mongod 2>/dev/null; then
    log "Instalando MongoDB 7..."
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
         gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor --yes
    UBUNTU_CODENAME=$(lsb_release -cs)
    [ "$UBUNTU_CODENAME" = "noble" ] && UBUNTU_CODENAME="jammy"
    echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME}/mongodb-org/7.0 multiverse" \
        > /etc/apt/sources.list.d/mongodb-org-7.0.list
    apt-get update -qq
    apt-get install -y -qq mongodb-org
    systemctl enable --now mongod
    sleep 3
fi
ok "MongoDB ativo"

# -------- 5. Usuário do sistema --------
if ! id "$APP_USER" &>/dev/null; then
    log "Criando usuário '$APP_USER'..."
    useradd -m -s /bin/bash "$APP_USER"
fi

# -------- 6. Diretório do projeto --------
if [ ! -d "$APP_DIR" ]; then
    if [ -n "$GIT_REPO" ]; then
        log "Clonando $GIT_REPO em $APP_DIR..."
        git clone "$GIT_REPO" "$APP_DIR"
    else
        log "Criando diretório $APP_DIR (você precisará copiar o código manualmente)..."
        mkdir -p "$APP_DIR"
        cat <<EOF > "$APP_DIR/README_DEPLOY.txt"
Coloque o código do projeto em: $APP_DIR
Estrutura esperada:
  $APP_DIR/backend/   <- FastAPI
  $APP_DIR/frontend/  <- React
Depois rode novamente: bash install.sh
EOF
        warn "Sem GIT_REPO definido. Coloque o código em $APP_DIR e rode novamente."
        warn "Ou: GIT_REPO=https://github.com/seu-usuario/seu-repo.git bash install.sh"
        exit 0
    fi
else
    log "Atualizando código existente..."
    if [ -d "$APP_DIR/.git" ]; then
        cd "$APP_DIR" && git pull --ff-only || warn "Falha no git pull (continuando)"
    fi
fi

[ -d "$APP_DIR/backend" ] || die "$APP_DIR/backend não encontrado. Coloque o código antes."
[ -d "$APP_DIR/frontend" ] || die "$APP_DIR/frontend não encontrado."

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# -------- 7. Backend: venv + dependências --------
log "Configurando backend Python ($PY_BIN)..."
cd "$APP_DIR/backend"

sudo -u "$APP_USER" "$PY_BIN" -m venv venv
# Remove dependências internas da plataforma Emergent (não existem no PyPI público)
sudo -u "$APP_USER" grep -vE '^(emergentintegrations)' requirements.txt > /tmp/requirements-public.txt
sudo -u "$APP_USER" bash -c "source venv/bin/activate && pip install --upgrade pip --quiet && pip install -r /tmp/requirements-public.txt --quiet"
rm -f /tmp/requirements-public.txt

# .env do backend
cat > "$APP_DIR/backend/.env" <<EOF
MONGO_URL="${MONGO_URL}"
DB_NAME="${DB_NAME}"
CORS_ORIGINS="*"
JWT_SECRET="${JWT_SECRET}"
SUPER_ADMIN_EMAIL="${SUPER_ADMIN_EMAIL}"
SUPER_ADMIN_PASSWORD="${SUPER_ADMIN_PASSWORD}"
SEED_TENANT_DEMO=${SEED_DEMO}
EOF
chown "$APP_USER":"$APP_USER" "$APP_DIR/backend/.env"
chmod 600 "$APP_DIR/backend/.env"
ok "Backend configurado"

# -------- 8. Frontend: build --------
log "Buildando frontend..."
cd "$APP_DIR/frontend"

# .env do frontend (REACT_APP_BACKEND_URL aponta para o domínio público)
PUBLIC_URL="${DOMAIN:+https://$DOMAIN}"
PUBLIC_URL="${PUBLIC_URL:-http://$(hostname -I | awk '{print $1}')}"
cat > "$APP_DIR/frontend/.env" <<EOF
REACT_APP_BACKEND_URL=${PUBLIC_URL}
WDS_SOCKET_PORT=443
EOF

sudo -u "$APP_USER" bash -c "cd $APP_DIR/frontend && yarn install --silent && yarn build"
ok "Frontend build em $APP_DIR/frontend/build"

# -------- 9. Supervisor para o backend --------
log "Configurando Supervisor..."
cat > /etc/supervisor/conf.d/${APP_NAME}-backend.conf <<EOF
[program:${APP_NAME}-backend]
command=$APP_DIR/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --workers 2
directory=$APP_DIR/backend
user=$APP_USER
autostart=true
autorestart=true
stderr_logfile=/var/log/${APP_NAME}-backend.err.log
stdout_logfile=/var/log/${APP_NAME}-backend.out.log
environment=PYTHONUNBUFFERED="1"
stopasgroup=true
killasgroup=true
EOF

mkdir -p "$APP_DIR/backend/uploads"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/backend/uploads"

supervisorctl reread
supervisorctl update
supervisorctl restart ${APP_NAME}-backend
ok "Supervisor: backend rodando em :8001"

# -------- 9b. Sudoers: permitir que o backend reinicie o supervisor e git --------
log "Configurando sudoers para atualização via web..."
cat > /etc/sudoers.d/${APP_NAME}-webupdate <<EOF
# Permite que o backend (user: ${APP_USER}) reinicie o supervisor para o update via web
${APP_USER} ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl restart ${APP_NAME}-backend
${APP_USER} ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl reload
EOF
chmod 0440 /etc/sudoers.d/${APP_NAME}-webupdate

# Permite que o usuário voxyra use git em /opt/CallCenter sem erro de ownership
sudo -u ${APP_USER} git config --global --add safe.directory $APP_DIR 2>/dev/null || true
git config --global --add safe.directory $APP_DIR 2>/dev/null || true
ok "Sudoers + git config prontos para atualização via web"

# -------- 10. Nginx --------
log "Configurando Nginx..."
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/${APP_NAME} <<NGINX
server {
    listen 80;
    server_name ${SERVER_NAME};
    client_max_body_size 50M;

    # Frontend (build estático)
    root $APP_DIR/frontend/build;
    index index.html;

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # Uploads (logos)
    location /uploads/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
    }

    # Frontend SPA
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache assets
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss;
}
NGINX

ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/${APP_NAME}
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
ok "Nginx ativo"

# -------- 11. Firewall --------
if command -v ufw &>/dev/null; then
    log "Configurando firewall..."
    ufw allow 22/tcp >/dev/null 2>&1 || true
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    ufw --force enable >/dev/null 2>&1 || true
    ok "UFW: 22, 80, 443"
fi

# -------- 12. SSL (opcional) --------
if [ -n "$DOMAIN" ]; then
    if [[ "${EMAIL_LE}" != "admin@example.com" ]]; then
        log "Solicitando certificado SSL para $DOMAIN..."
        apt-get install -y -qq certbot python3-certbot-nginx
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL_LE" --redirect || \
            warn "Falha no SSL. Configure manualmente: certbot --nginx -d $DOMAIN"
    else
        warn "Defina EMAIL_LE para gerar SSL automaticamente. Ex: EMAIL_LE=voce@dominio.com bash install.sh"
    fi
fi

# -------- 13. Resumo final --------
clear
cat <<EOF

╔══════════════════════════════════════════════════════════════════╗
║              ✓ INSTALAÇÃO CONCLUÍDA COM SUCESSO                  ║
╚══════════════════════════════════════════════════════════════════╝

  🌐 URL pública:        ${PUBLIC_URL}
  🔐 Super Admin:        ${SUPER_ADMIN_EMAIL}
  🔑 Senha:              ${SUPER_ADMIN_PASSWORD}
  📁 App dir:            ${APP_DIR}
  💾 MongoDB:            ${MONGO_URL}/${DB_NAME}

──────────────────── COMANDOS ÚTEIS ────────────────────
  Logs do backend:       tail -f /var/log/${APP_NAME}-backend.out.log
  Reiniciar backend:     supervisorctl restart ${APP_NAME}-backend
  Logs do nginx:         tail -f /var/log/nginx/error.log
  Atualizar código:      cd ${APP_DIR} && git pull && bash install.sh

⚠  GUARDE A SENHA DO SUPER ADMIN! Ela só será exibida agora.

EOF

# -------- 14. Salvar credenciais em arquivo seguro --------
CREDS_FILE="/root/${APP_NAME}-credentials.txt"
cat > "$CREDS_FILE" <<EOF
# Voxyra CCA - Credenciais de Instalação · $(date)
URL: ${PUBLIC_URL}
Super Admin Email: ${SUPER_ADMIN_EMAIL}
Super Admin Password: ${SUPER_ADMIN_PASSWORD}
JWT Secret: ${JWT_SECRET}
MongoDB: ${MONGO_URL}
DB Name: ${DB_NAME}
EOF
chmod 600 "$CREDS_FILE"
ok "Credenciais salvas em ${CREDS_FILE}"
