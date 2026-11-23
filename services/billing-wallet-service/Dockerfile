# Contexto de build: carpeta services/  ->  docker build -f billing-wallet-service/Dockerfile -t aegisvolt/billing-wallet-service:TAG .
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4002
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY billing-wallet-service ./billing-wallet-service
USER node
EXPOSE 4002
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:4002/health || exit 1
CMD ["node", "billing-wallet-service/src/index.js"]
