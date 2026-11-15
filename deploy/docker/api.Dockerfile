# API + worker + migrate image (deploy/docker-compose.prod.yml). Build context: the repo root.
#   build:   all workspace deps, then `scripts/build.ts` bundles the backend and @zuvo/* into dist/
#   runtime: production dependencies only (pnpm deploy), non-root `node` user, no pnpm, no sources
# NODE_ENV is never "test" here: built and run as production, so test-only routes are never registered.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
# No lifecycle scripts anywhere in the build (install and deploy): none is needed, and the root
# `prepare` (lefthook install) needs git, which the image does not have.
ENV CI=true npm_config_ignore_scripts=true
WORKDIR /repo
# pnpm from package.json "packageManager" (same version as local and CI).
RUN npm install -g --no-audit --no-fund pnpm@10.34.8
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY shared/config/package.json shared/config/
COPY shared/protocol/package.json shared/protocol/
COPY shared/ui-tokens/package.json shared/ui-tokens/
# Dev dependencies too: the build needs esbuild. No install scripts (none are needed; see pnpm-workspace.yaml).
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@zuvo/backend..."
COPY shared shared
COPY backend backend
RUN NODE_ENV=production pnpm --filter @zuvo/backend build \
  && pnpm --filter @zuvo/backend deploy --legacy --prod /out \
  && rm -rf /out/src /out/test /out/load /out/scripts /out/storage /out/dist \
  && cp -r backend/dist /out/dist

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
# Media lives in /data/uploads: a bind mount owned by 1000:1000 (= `node`), see deploy/scripts/setup-env.sh.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 4000
# Liveness only (the worker and migrate services turn it off). Readiness (MongoDB, Redis, disk) is
# GET /v1/ready, checked by correm-deploy and the deploy workflow.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
