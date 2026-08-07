# ---------------------------------------------------------------------------
# Yu-tomation runtime image.
#
# Multi-stage so that the published image contains production dependencies,
# the compiled JavaScript (including the generated Prisma client) and the
# prompt files — and nothing else.
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
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The generous fetch timeout is for slow or throttled registry access inside a
# build container; it costs nothing when the network is healthy.
RUN pnpm install --frozen-lockfile --fetch-timeout 300000

# --- Stage 2: build ---------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY src ./src
# The Prisma client is generated into src/database/generated, so it must exist
# before tsc runs. No database is contacted at build time.
RUN pnpm exec prisma generate
# Pre-download the Prisma migration engine (schema-engine) during build while network is available
RUN DATABASE_URL="postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder" pnpm exec prisma migrate status || true
RUN pnpm exec tsc --project tsconfig.build.json
# Prompts are data, not code: tsc ignores them, so copy them next to the build.
RUN cp -R src/prompts dist/prompts

# --- Stage 3: production dependencies --------------------------------------
FROM build AS prod-deps
WORKDIR /app
RUN pnpm prune --prod

# --- Stage 4: runtime -------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# FFmpeg renders the final video. Debian's package is built with libass, which
# is what makes burned-in subtitles possible; a build without it cannot render
# captions at all.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Kept so `prisma migrate deploy` can be run against a live database from
# inside this image.
COPY src/database/prisma ./src/database/prisma
COPY src/database/migrations ./src/database/migrations
COPY prisma.config.ts ./

# Preserve Playwright browser and Prisma cached engine binaries for both root (migrate) and node (backend) users
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
RUN node node_modules/playwright/cli.js install-deps chromium \
 && node node_modules/playwright/cli.js install chromium

COPY --from=build /root/.cache/prisma /root/.cache/prisma
RUN mkdir -p /home/node/.cache && cp -R /root/.cache/prisma /home/node/.cache/prisma && chown -R node:node /home/node/.cache

# Scratch space for disposable media. Deleted by the Cleanup Agent after every
# verified upload.
RUN mkdir -p /app/output && chown -R node:node /app/output

USER node
CMD ["node", "dist/main.js", "generate"]
