# syntax=docker/dockerfile:1

# ---- dependencies ----------------------------------------------------------
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app

# The worker is a workspace member, so its manifest has to be present for the
# lockfile to resolve.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY worker/package.json ./worker/
# Both packages: the build bundles the worker, so its dependencies are needed.
RUN pnpm install --frozen-lockfile

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/worker/node_modules ./worker/node_modules
COPY . .

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
