# The portal on Cloud Run.
#
# This ships a Node server rather than a folder of files for a CDN, because the
# portal is not a static site: every case the UI shows arrives through a route
# handler in src/app/api, which mints a Google ID token and proxies to the
# control plane. Those run per request, and the browser never holds a credential
# or an upstream URL — that is the whole point of the arrangement, and it needs
# a server to hold up its end.

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# `npm ci` rather than `npm install` so the image is built from the committed
# lockfile and not from whatever resolves today. Running it in the linux image
# is also what produces the linux build of sharp; a lockfile installed on a Mac
# leaves behind a binary the container cannot load.
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_ variables are read while the bundle is compiled, not while the
# server runs, so this has to be an argument to the build. Setting it on the
# Cloud Run service instead would do nothing: by the time a container starts,
# the value is already baked into the JavaScript the browser downloads.
ARG NEXT_PUBLIC_COPILOT_ENABLED=true
ENV NEXT_PUBLIC_COPILOT_ENABLED=$NEXT_PUBLIC_COPILOT_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Cloud Run routes traffic to $PORT and needs the server listening on every
# interface. Next binds to localhost unless told otherwise, which would pass
# nothing and fail every health check the platform makes.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# The standalone build carries its own traced node_modules, so nothing is
# installed here. Static assets and public/ are the two things the trace
# deliberately leaves out, so they are copied in beside it.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# The two auth backdrops go through next/image, which optimises them on the
# first request using sharp's native binary. sharp is an optional dependency of
# next rather than of this project, so it is copied across explicitly rather
# than left to the module trace to notice.
COPY --from=deps /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps /app/node_modules/@img ./node_modules/@img

# Those optimised images are written back to .next/cache, which means the one
# directory an unprivileged process needs to own is this one.
RUN mkdir -p .next/cache && chown -R node:node .next

USER node
EXPOSE 8080

CMD ["node", "server.js"]
