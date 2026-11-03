# Connect backend. Multi-arch base (amd64 + arm64, e.g. Oracle Ampere A1).

# Dependencies. mediasoup's install downloads a prebuilt C++ worker for this
# CPU/kernel; the compilers below are only used if it has to build one instead.
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# Full install: the prisma CLI (a devDependency) runs migrations at startup.
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src

ENV NODE_ENV=production PORT=5000
EXPOSE 5000
# 40000: mediasoup (live-stream media), UDP with TCP fallback
EXPOSE 40000/udp 40000/tcp
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && exec node src/server.js"]
