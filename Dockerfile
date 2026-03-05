FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files and install all dependencies (including devDeps for build + drizzle-kit)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build frontend (Vite) and backend (esbuild) in Docker mode
RUN DEPLOY_MODE=docker pnpm build

# Create upload directory
RUN mkdir -p /app/data/uploads

# Make entrypoint executable
RUN chmod +x entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
