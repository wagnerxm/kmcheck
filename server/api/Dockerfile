FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs chaves.mjs ./
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
