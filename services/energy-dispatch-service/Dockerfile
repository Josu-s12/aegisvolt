# Contexto de build: carpeta services/  ->  docker build -f energy-dispatch-service/Dockerfile -t aegisvolt/energy-dispatch-service:TAG .
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4003
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY energy-dispatch-service ./energy-dispatch-service
USER node
EXPOSE 4003
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:4003/health || exit 1
CMD ["node", "energy-dispatch-service/src/index.js"]
