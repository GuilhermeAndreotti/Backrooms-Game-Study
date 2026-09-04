# syntax=docker/dockerfile:1

# --- Stage 1: build the client bundle and the server bundle -----------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Reinstall with production dependencies only; this is what ships in the
# runtime image (the server bundle is built with --packages=external).
RUN npm ci --omit=dev

# --- Stage 2: minimal runtime ----------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

# Runtime config (see .env.example). These become the image's default ENV
# values; docker-compose/`docker run -e` still override them per container.
ARG PORT=3000
ARG HOST=0.0.0.0
ARG WS_PATH=/ws
ARG ROOM_CAPACITY=4
ARG TICK_HZ=20
ARG MAX_ROOMS=200
ARG MAX_CONNECTIONS=200

ENV PORT=$PORT
ENV HOST=$HOST
ENV WS_PATH=$WS_PATH
ENV ROOM_CAPACITY=$ROOM_CAPACITY
ENV TICK_HZ=$TICK_HZ
ENV MAX_ROOMS=$MAX_ROOMS
ENV MAX_CONNECTIONS=$MAX_CONNECTIONS

WORKDIR /app

# Run unprivileged: the `node` user ships with the official image.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
