# Dockerfile dos workers Node.js do BetEdge (polling de odds, avaliação de
# alertas, disparo de notificações). Roda via `tsx` diretamente (sem etapa
# de build para .js — TypeScript é executado em runtime), mantendo o mesmo
# código-fonte usado em desenvolvimento (`npm run dev`).

FROM node:20-slim AS base

WORKDIR /app

# Copia apenas os manifestos primeiro para aproveitar o cache de camadas do
# Docker — reinstalar dependências só quando package*.json mudar.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN useradd --create-home --shell /bin/bash betedge && chown -R betedge:betedge /app
USER betedge

ENV NODE_ENV=production

CMD ["npx", "tsx", "src/index.ts"]
