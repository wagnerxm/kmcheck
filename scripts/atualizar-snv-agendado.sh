#!/usr/bin/env bash
# Checagem diária do SNV (Agendador de Tarefas do Windows, 04:00, no PC do Wagner).
#
# Por que aqui e não no GitHub: a nuvem do DNIT recusa conexão de fora do Brasil (os computadores do GitHub e o
# VPS ficam nos EUA). Este PC está no Brasil.
#
# O que faz: numa CÓPIA À PARTE do repositório (não mexe na pasta de trabalho), confere se o DNIT publicou SNV
# novo. Se não publicou, termina em segundos. Se publicou: gera as 363 rodovias + a pista dupla, grava no
# GitHub (o site atualiza sozinho) e atualiza o servidor (kmcheck.com.br, de onde o app da loja baixa).
#
# Tudo fica fora do repositório, em C:\Users\wagne\Claude\kmcheck-snv\ : o código do link do DNIT
# (snv-token.txt), a cópia do repositório (repo\), o registro (atualizacao.log, últimas 400 linhas) e a saída da
# última execução (tarefa.log). Tarefa do Windows: "KM Check - checagem diaria do SNV" → rodar.cmd.
# (AppData não serve: os arquivos criados ali pelo Claude Code ficam numa área que o Agendador não enxerga.)
set -u
BASE="/c/Users/wagne/Claude/kmcheck-snv"
REPO="$BASE/repo"
LOG="$BASE/atualizacao.log"
TOKEN_ARQ="$BASE/snv-token.txt"
mkdir -p "$BASE"
log(){ echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
corta_log(){ tail -n 400 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"; }
trap corta_log EXIT

log "== checagem do SNV"
if [ ! -s "$TOKEN_ARQ" ]; then log "ERRO: falta o código do link do DNIT em $TOKEN_ARQ"; exit 1; fi

# cópia de trabalho só da automação: sempre igual ao GitHub antes de começar
if [ ! -d "$REPO/.git" ]; then
  log "clonando o repositório (1ª vez)"
  git clone -q https://github.com/wagnerxm/kmcheck.git "$REPO" >> "$LOG" 2>&1 || { log "ERRO: git clone"; exit 1; }
fi
cd "$REPO" || exit 1
git fetch -q origin main >> "$LOG" 2>&1 && git reset -q --hard origin/main || { log "ERRO: git fetch (sem internet?)"; exit 1; }

[ -d scripts/node_modules/undici ] || (cd scripts && npm install --no-save --no-package-lock undici@6 >> "$LOG" 2>&1)

WEBDAV_SHARE_TOKEN="$(tr -d '\r\n' < "$TOKEN_ARQ")" node scripts/fetch-snv-wfs.mjs >> "$LOG" 2>&1
st=$?
rm -rf .tmp-snv
if [ $st -ne 0 ]; then log "ERRO: o script do SNV falhou (código $st) — tenta de novo amanhã"; exit 1; fi

if [ -z "$(git status --porcelain data/)" ]; then log "sem SNV novo"; exit 0; fi

SNV=$(node -e "process.stdout.write(require('./data/rodovias/index.json').snv)")
git add data/
git commit -q -m "Update SNV road data $SNV" >> "$LOG" 2>&1
git push -q origin main >> "$LOG" 2>&1 || { git pull -q --rebase origin main >> "$LOG" 2>&1 && git push -q origin main >> "$LOG" 2>&1; } \
  || { log "ERRO: git push"; exit 1; }
log "SNV $SNV gravado no GitHub"
ssh -i "$HOME/.ssh/vps_contabo" -o ConnectTimeout=30 -o BatchMode=yes root@80.190.78.56 '/opt/kmcheck-app-atualizar.sh' >> "$LOG" 2>&1 \
  && log "servidor atualizado" || log "ERRO: não consegui atualizar o servidor (rodar /opt/kmcheck-app-atualizar.sh à mão)"
