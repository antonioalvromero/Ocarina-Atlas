FROM oven/bun:1.4 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun --bun vite build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "--bun", "vite", "preview"]
