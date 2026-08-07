# ---------------------------------------------------------------------------
# Yu-tomation editor (Next.js) runtime image.
#
# Multi-stage, and shaped like the backend's Dockerfile on purpose: the two are
# maintained together and a difference between them should mean something.
#
# The published image carries production dependencies, the compiled `.next`
# output and the public assets — no sources, no toolchain.
#
# Deliberately free of BuildKit-only syntax, so it builds with the classic
# builder as well as with `docker buildx`.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:24-bookworm-slim

# --- Stage 1: dependencies --------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Corepack must not stop on a prompt in a non-interactive build.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The generous fetch timeout is for slow or throttled registry access inside a
# build container; it costs nothing when the network is healthy.
RUN pnpm install --frozen-lockfile --fetch-timeout 300000

# --- Stage 2: build ---------------------------------------------------------
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.json next.config.mjs postcss.config.mjs middleware.ts ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
# Every page is `force-dynamic` or `force-static`, so nothing here calls the
# backend: the build needs no database, no API and no secrets.
RUN pnpm exec next build

# --- Stage 3: production dependencies --------------------------------------
FROM deps AS prod-deps
WORKDIR /app
RUN pnpm prune --prod

# --- Stage 4: runtime -------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Without this Next binds to localhost inside the container, where nothing
# outside it can reach the server.
ENV HOSTNAME=0.0.0.0

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json next.config.mjs ./

USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
