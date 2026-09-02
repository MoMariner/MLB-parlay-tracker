# Single-stage: the build needs devDependencies (vite, prisma, tsc) and the
# image is small enough that splitting them out isn't worth the complexity.
FROM node:22-slim

# Prisma's query engine needs OpenSSL at runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

# Compile the server to plain JS and bundle the dashboard.
RUN npx prisma generate \
    && npx tsc -p tsconfig.server.json \
    && npx vite build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Create the schema on a fresh volume, then start. `db push` is idempotent, so
# this is a no-op on every restart after the first.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/server/index.js"]
