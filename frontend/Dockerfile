FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# GRAPHQL_UPSTREAM se resuelve con envsubst al arrancar (imagen oficial de nginx)
ENV GRAPHQL_UPSTREAM=http://graphql-gateway:4000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
