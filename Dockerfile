FROM node:20-slim

# Puppeteer用Chromium依存ライブラリ
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-noto-cjk \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# PuppeteerにシステムのChromiumを使わせる
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
