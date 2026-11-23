# Contexto de build: carpeta services/  ->  docker build -f graphql-gateway/Dockerfile -t aegisvolt/graphql-gateway:TAG .
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY graphql-gateway ./graphql-gateway
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "graphql-gateway/src/index.js"]
