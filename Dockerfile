# ─────────────────────────────────────────────────────────────────
# COSMODEX — Dockerfile
# Multi-stage build:
#   Stage 1 (deps)  — install production deps only
#   Stage 2 (build) — compile TypeScript
#   Stage 3 (run)   — lean runtime image
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: Install all deps (including devDeps for build) ───────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

# ── Stage 2: Build TypeScript ─────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Compile TypeScript → dist/
RUN npm run build

# ── Stage 3: Lean runtime image ───────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /app

ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:${PATH}"

# Install language runtimes for native code execution (Python, C++)
# Node.js is already available in this image for JavaScript
RUN apk add --no-cache python3 g++ musl-dev

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output and Prisma files
COPY --from=build /app/dist          ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma  ./node_modules/@prisma
COPY prisma       ./prisma
COPY client       ./client

# Expose HTTP port
EXPOSE 3000

# Run DB migrations, seed problems (idempotent), then start the server
CMD ["sh", "-c", "prisma migrate deploy && tsx prisma/seed.ts && node dist/server.js"]
