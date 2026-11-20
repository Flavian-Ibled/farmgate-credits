# Image de production (Railway, Render, Scaleway… n'importe quel hébergeur de conteneurs en UE)
FROM node:22-bookworm-slim
# Chromium + polices pour les PDF des fiches (server/pages.ts)
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx vite build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 \
    FG_CHROME=/usr/bin/chromium CHROMIUM_FLAGS=--no-sandbox FG_WEB_URL=http://127.0.0.1:8080 \
    FG_DATA_DIR=/data
EXPOSE 8080
CMD ["npx", "tsx", "server/index.ts"]
