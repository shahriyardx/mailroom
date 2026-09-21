# syntax=docker/dockerfile:1

# ---- dependencies ----------------------------------------------------------
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app

# Manifests only, and every workspace member's: --frozen-lockfile checks the
# lockfile against all of them, so one missing manifest fails the install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY worker/package.json ./worker/
COPY packages/sdk/package.json ./packages/sdk/
COPY docs/package.json ./docs/

# Only the app and the worker are installed. The build bundles the worker, so
# its dependencies are needed; the docs site and the SDK are built and
# published separately and would add VitePress and wrangler for nothing.
RUN pnpm install --frozen-lockfile --filter mail --filter mail-inbound-worker

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/worker/node_modules ./worker/node_modules
# Named rather than `COPY . .`: the repository also holds a docs site and an
# SDK that this image has no use for, and an explicit list cannot quietly
# start carrying the next thing added beside them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# next-env.d.ts is deliberately absent: it is generated, it is in .gitignore,
# and so it is not in the clone this image is built from. `next build` writes
# it before it type-checks anything, so copying it in was never needed.
COPY next.config.ts postcss.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY worker ./worker

# Public build-time values. Anything secret is supplied at run time instead.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1

# Runs the worker bundler first, so the uploaded script matches worker/src.
RUN pnpm run build

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone output carries its own minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# SQL migrations, applied on boot by src/instrumentation.ts.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
