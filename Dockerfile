FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run check

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4173 WATCHSWEEPERR_DATA_DIR=/app/data
COPY package*.json ./
RUN apk add --no-cache su-exec \
    && npm ci --omit=dev \
    && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node shared.ts genres.ts ./
COPY docker-entrypoint.sh /usr/local/bin/watchsweeperr-entrypoint
RUN chmod 755 /usr/local/bin/watchsweeperr-entrypoint \
    && mkdir -p /app/data \
    && chown node:node /app/data
VOLUME /app/data
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" | grep -q '"ok":true' || exit 1
ENTRYPOINT ["watchsweeperr-entrypoint"]
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
