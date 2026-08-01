# 生产镜像：构建 TS + Prisma Client，仅运行 dist
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npx prisma generate
RUN npm run build

# 数据库同步使用此阶段，保留 Prisma CLI 和迁移引擎。
FROM builder AS migration

# 运行镜像仅保留生产依赖，避免携带构建工具。
FROM builder AS runtime-builder
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 update \
  && apt-get install -y --no-install-recommends openssl ca-certificates default-mysql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=runtime-builder /app/node_modules ./node_modules
COPY --from=runtime-builder /app/dist ./dist
COPY --from=runtime-builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/main.js"]
