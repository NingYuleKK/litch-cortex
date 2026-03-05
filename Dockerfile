# --- Build Stage ---
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install all dependencies (including devDeps for build)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN DEPLOY_MODE=docker pnpm build

# --- Production Stage ---
FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built artifacts and node_modules from builder
# node_modules is copied in full so drizzle-kit is available for DB migrations at runtime
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/entrypoint.sh ./

RUN mkdir -p /app/data/uploads && chmod +x entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
