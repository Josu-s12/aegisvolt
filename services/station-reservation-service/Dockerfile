# Contexto de build: carpeta services/  ->  docker build -f station-reservation-service/Dockerfile -t aegisvolt/station-reservation-service:TAG .
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY station-reservation-service ./station-reservation-service
USER node
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:4001/health || exit 1
CMD ["node", "station-reservation-service/src/index.js"]
