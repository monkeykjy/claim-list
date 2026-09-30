FROM node:22.23.1-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.9.0

FROM base AS dependencies
# Native SQLite can fall back to compilation when a prebuilt binary is unavailable.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN CI=true pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build && mkdir -p public
RUN CI=true pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production \
    LISTEN_HOST=0.0.0.0 \
    PORT=1234 \
    DATABASE_PATH=/data/claim-list.sqlite
RUN apt-get update \
    && apt-get install --yes --no-install-recommends gosu util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data \
    && chown node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc /app/tsconfig.json /app/next.config.ts ./
# Dependencies are frozen at build time; maintenance commands must work offline.
RUN printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --chmod=755 deploy/docker-entrypoint.sh /usr/local/bin/claimlist-entrypoint
EXPOSE 1234
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:1234/api/list',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["claimlist-entrypoint"]
# Keep the custom server: it supplies the trusted client IP and origin headers.
CMD ["node", "--import", "tsx", "scripts/server.ts", "--production", "--hostname", "0.0.0.0", "--port", "1234"]
