# Web image: the built PWA (frontend/dist) served by unprivileged Nginx on :8080. Build context: repo root.
# The host Nginx in front adds TLS, HTTP/2, the security headers and the cache rules
# (deploy/nginx/zuvo.corremadvisory.com.conf). Production build: NODE_ENV=production, never "test".
ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine

# Which commit this is (GET /v1/health, Help → About). Only .git/HEAD and branch refs are in the
# context (.dockerignore), and only build-info.json leaves this stage. `.gi[t]` is a pattern, so a
# context without .git still builds (commit "unknown"); the copy beside it keeps the pattern legal.
FROM ${NODE_IMAGE} AS meta
WORKDIR /meta
COPY backend/package.json backend/
COPY backend/scripts/build-info.ts backend/scripts/
COPY backend/src/lib/git-commit.ts backend/src/lib/
COPY backend/package.json .gi[t] git/
RUN node backend/scripts/build-info.ts git build-info.json

FROM ${NODE_IMAGE} AS build
ENV CI=true npm_config_ignore_scripts=true
WORKDIR /repo
RUN npm install -g --no-audit --no-fund pnpm@10.34.8
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
COPY shared/config/package.json shared/config/
COPY shared/protocol/package.json shared/protocol/
COPY shared/ui-tokens/package.json shared/ui-tokens/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@zuvo/frontend..."
COPY shared shared
COPY frontend frontend
# Last, so a new commit rebuilds only this step (the commit is inlined into the app).
COPY --from=meta /meta/build-info.json /repo/build-info.json
RUN NODE_ENV=production ZUVO_BUILD_INFO=/repo/build-info.json pnpm --filter @zuvo/frontend build

FROM ${NGINX_IMAGE} AS runtime
COPY deploy/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=5 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health"]
