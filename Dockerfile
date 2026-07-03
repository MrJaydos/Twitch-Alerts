FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Persist config outside the image so restarts keep your settings.
ENV CONFIG_PATH=/data/config.json
VOLUME ["/data"]

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
