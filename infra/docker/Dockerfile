# syntax=docker/dockerfile:1
ARG KNOWLEDGE_IMAGE_TARGET=api
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get -o Acquire::http::Proxy="${HTTP_PROXY:-}" update && apt-get -o Acquire::http::Proxy="${HTTP_PROXY:-}" install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/prisma apps/api/prisma
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci; else npm ci; fi
COPY --chown=node:node . .
RUN npm run build

FROM build AS api
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run migration && node apps/api/dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
USER root
RUN mkdir -p /etc/nginx/templates && chown nginx:nginx /etc/nginx/templates && chmod 755 /etc/nginx/templates
USER nginx
ENV API_UPSTREAM=api:3000
ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
COPY --chown=nginx:nginx --chmod=0644 infra/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=nginx:nginx /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

# Railway builds the final stage; Compose selects api/web explicitly.
FROM ${KNOWLEDGE_IMAGE_TARGET} AS release
