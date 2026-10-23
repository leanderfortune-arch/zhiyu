FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run web:build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production ZHIYU_WEB=1 ZHIYU_DATA_DIR=/data HOST=0.0.0.0 PORT=8091
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist-web ./dist-web
COPY electron ./electron
COPY web ./web
COPY public/brand/zhiyu.svg ./public/brand/zhiyu.svg
COPY LICENSE ./LICENSE
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/leanderfortune-arch/zhiyu" org.opencontainers.image.revision=$VCS_REF
USER node
EXPOSE 8091
CMD ["node", "web/server.mjs"]
