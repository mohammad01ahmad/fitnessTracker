# Single-stage: this project has no build step (Node strips TS types at
# runtime natively — see engines.node in package.json), so there's nothing
# to compile ahead of time.
FROM node:25-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

CMD ["node", "src/index.js"]
