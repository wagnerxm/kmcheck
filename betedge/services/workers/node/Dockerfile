# =============================================================================
# Dockerfile — Workers Node.js (BullMQ)
#
# Multi-stage build:
# 1. Instala dependências com pnpm (cache eficiente).
# 2. Compila TypeScript.
# 3. Imagem final enxuta com apenas o runtime.
# =============================================================================

# --- Stage 1: Dependências ---
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile --prod=false

# --- Stage 2: Build ---
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# --- Stage 3: Runtime ---
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Apenas dependências de produção
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile --prod

# Copiar artefatos compilados
COPY --from=builder /app/dist ./dist

# Healthcheck via processo Node (sem HTTP neste serviço)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "process.exit(0)"

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
