FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY sync.mjs map.mjs schema.sql ./
USER node
CMD ["node", "sync.mjs"]
