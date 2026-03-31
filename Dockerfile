# ── Stage 1: build the Next.js frontend ──────────────────────────────────────
FROM node:20-bookworm AS builder

ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

WORKDIR /build/site
COPY site/package.json ./
RUN npm install --legacy-peer-deps
COPY site/ ./
RUN npm run build

# ── Stage 2: runtime (Node 20 + MongoDB 7 + pm2) ─────────────────────────────
FROM node:20-bookworm

# Install MongoDB 7
RUN apt-get update && apt-get install -y gnupg curl && \
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
      gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor && \
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
      > /etc/apt/sources.list.d/mongodb-org-7.0.list && \
    apt-get update && \
    apt-get install -y mongodb-org && \
    rm -rf /var/lib/apt/lists/*

# Install pm2 globally
RUN npm install -g pm2

# Install API dependencies
WORKDIR /app/api
COPY api/package.json ./
RUN npm install --omit=dev
COPY api/ ./

# Copy built Next.js output and install production deps
WORKDIR /app/site
COPY site/package.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY --from=builder /build/site/.next ./.next
COPY --from=builder /build/site/public ./public
COPY site/next.config.js ./
COPY site/commodities.json ./
COPY site/rarecommodities.json ./

# pm2 ecosystem config lives at app root
WORKDIR /app
COPY pm2.config.js ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Data directory for internal MongoDB
RUN mkdir -p /data/db

EXPOSE 3000 3001

ENTRYPOINT ["/app/entrypoint.sh"]
