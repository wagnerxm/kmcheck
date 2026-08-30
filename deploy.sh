#!/bin/bash
# =============================================================================
# deploy.sh — NO.BLIND / BetEdge: setup automático do Contabo VPS
#
# Uso: curl -fsSL https://raw.githubusercontent.com/wagnerxm/kmcheck/main/deploy.sh | bash
# Ou:  bash deploy.sh
#
# O que faz:
# 1. Instala Docker + Docker Compose (se não tiver)
# 2. Clona o repositório
# 3. Cria o .env com as credenciais
# 4. Builda e sobe a stack (Redis + Engine + Workers)
# =============================================================================

set -euo pipefail

# Cores para o terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # sem cor

info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[AVISO]${NC} $1"; }
error() { echo -e "${RED}[ERRO]${NC}  $1"; exit 1; }

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       🚀 NO.BLIND — Deploy Automático           ║${NC}"
echo -e "${BLUE}║       Contabo VPS + Supabase                     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ─── 1. Verificar/instalar Docker ─────────────────────────────────────────
if command -v docker &>/dev/null; then
    ok "Docker já instalado: $(docker --version)"
else
    info "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    ok "Docker instalado"
fi

if docker compose version &>/dev/null; then
    ok "Docker Compose disponível: $(docker compose version --short)"
else
    error "Docker Compose não encontrado. Atualize o Docker."
fi

# ─── 2. Criar diretório e clonar ──────────────────────────────────────────
APP_DIR="$HOME/apps/noblind"

if [ -d "$APP_DIR" ]; then
    info "Diretório $APP_DIR já existe. Atualizando..."
    cd "$APP_DIR"
    git pull origin main
    ok "Repositório atualizado"
else
    info "Clonando repositório..."
    mkdir -p "$HOME/apps"
    git clone https://github.com/wagnerxm/kmcheck.git "$APP_DIR"
    cd "$APP_DIR"
    ok "Repositório clonado em $APP_DIR"
fi

# ─── 3. Criar .env se não existir ─────────────────────────────────────────
ENV_FILE="$APP_DIR/betedge/.env"

if [ -f "$ENV_FILE" ]; then
    ok ".env já existe — mantendo configuração atual"
else
    info "Criando .env..."

    # Gerar ENGINE_API_KEY automaticamente
    ENGINE_KEY=$(openssl rand -hex 32)

    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Preciso de algumas credenciais para continuar    ${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
    echo ""
    read -p  "URL do Supabase (ex: https://xxx.supabase.co): " SB_URL
    read -p  "Supabase Anon Key: " SB_ANON
    read -sp "Supabase Service Role Key: " SB_SERVICE
    echo ""
    read -sp "Senha do Postgres do Supabase: " DB_PASS
    echo ""
    read -p  "SportsGameOdds API Key (ou deixe vazio): " SGO_KEY

    # Extrair project ref da URL do Supabase (ex: fyybovmpzoxrpipfnbzk)
    SB_REF=$(echo "$SB_URL" | sed 's|https://||;s|\.supabase\.co.*||')

    cat > "$ENV_FILE" <<ENVEOF
# === NO.BLIND — Produção (Contabo VPS) ===

# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=${SB_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SB_ANON}
SUPABASE_SERVICE_ROLE_KEY=${SB_SERVICE}

# --- Postgres (Supabase pooler — usado pelo Engine e Workers) ---
DATABASE_URL=postgresql+asyncpg://postgres.${SB_REF}:${DB_PASS}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres

# --- Redis (local, subido pelo Docker Compose) ---
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1

# --- Motor Estatístico ---
ENGINE_API_KEY=${ENGINE_KEY}
CORS_ORIGINS=https://wagnerxm.github.io
ENV=production
DEBUG=false

# --- SportsGameOdds ---
SPORTSGAMEODDS_API_KEY=${SGO_KEY}
SPORTSGAMEODDS_BASE_URL=https://api.sportsgameodds.com/v2

# --- Workers ---
NODE_ENV=production
WORKER_CONCURRENCY=3

# --- Shadow Mode ---
SHADOW_DRY_RUN=false
SHADOW_ENABLED=true
ENVEOF

    chmod 600 "$ENV_FILE"
    ok ".env criado em betedge/.env (ENGINE_API_KEY gerada automaticamente)"
fi

# ─── 4. Build e subir ─────────────────────────────────────────────────────
info "Construindo imagens Docker (pode demorar ~5-10 min na primeira vez)..."
cd "$APP_DIR/betedge/docker"
docker compose build

info "Subindo os serviços..."
docker compose up -d

# ─── 5. Verificar ─────────────────────────────────────────────────────────
echo ""
info "Aguardando serviços iniciarem (30s)..."
sleep 30

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Status dos serviços${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
docker compose ps
echo ""

# Testar Redis
if docker exec betedge-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "Redis: PONG ✓"
else
    warn "Redis: ainda iniciando..."
fi

# Testar Engine
if curl -sf http://localhost:8000/health &>/dev/null; then
    ok "Engine: respondendo na porta 8000 ✓"
else
    warn "Engine: ainda iniciando (verifique com: docker logs betedge-engine)"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Deploy concluído!                                            ║${NC}"
echo -e "${GREEN}║                                                                  ║${NC}"
echo -e "${GREEN}║  Diretório: ~/apps/noblind/betedge/docker                        ║${NC}"
echo -e "${GREEN}║                                                                  ║${NC}"
echo -e "${GREEN}║  Comandos úteis:                                                 ║${NC}"
echo -e "${GREEN}║  • Ver logs:    docker compose logs -f                           ║${NC}"
echo -e "${GREEN}║  • Reiniciar:   docker compose restart                           ║${NC}"
echo -e "${GREEN}║  • Parar:       docker compose down                              ║${NC}"
echo -e "${GREEN}║  • Atualizar:   cd ~/apps/noblind && git pull && \               ║${NC}"
echo -e "${GREEN}║                 cd betedge/docker && docker compose up -d --build ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
