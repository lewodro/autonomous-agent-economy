FROM rust:1.89-bookworm AS build
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY rust ./rust
COPY web ./web
COPY post ./post
COPY docs/devlog ./docs/devlog
COPY scripts/build-devlog.js ./scripts/build-devlog.js
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/rust/target/debug/table-core ./rust/target/debug/table-core
COPY --from=build /app/rust/target/debug/wallet-demo ./rust/target/debug/wallet-demo
COPY --from=build /app/web/dist ./web/dist
COPY package.json server.js index.html styles.css entry.css entry.js ./
COPY service ./service
COPY src ./src
COPY legacy ./legacy
COPY --from=build /app/post ./post
COPY world ./world
COPY labs ./labs
COPY assets ./assets
COPY scripts/start-production.sh ./scripts/start-production.sh
RUN mkdir -p /data/matches
ENV MATCHES_DIR=/data/matches
EXPOSE 3000
CMD ["sh", "scripts/start-production.sh"]
