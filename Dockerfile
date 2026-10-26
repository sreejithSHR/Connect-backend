# Connect backend. Multi-arch base (amd64 + arm64, e.g. Oracle Ampere A1).
FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# Full install: the prisma CLI (a devDependency) runs migrations at startup.
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src

ENV NODE_ENV=production PORT=5000
EXPOSE 5000
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && exec node src/server.js"]
