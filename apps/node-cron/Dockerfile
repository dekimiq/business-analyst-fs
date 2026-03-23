FROM node:24-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npx turbo run build

FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
COPY turbo.json ./

COPY apps/node-cron/package*.json ./apps/node-cron/
COPY packages/env/package*.json ./packages/env/
COPY packages/shared/package*.json ./packages/shared/

COPY packages/env/src/ ./packages/env/src/
COPY packages/shared/src/ ./packages/shared/src/

RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

WORKDIR /app/apps/node-cron

COPY --from=builder /app/apps/node-cron/dist ./dist/
COPY --from=builder /app/apps/node-cron/knexfile.ts ./
COPY --from=builder /app/apps/node-cron/migrations ./migrations/
COPY --from=builder /app/apps/node-cron/seeds ./seeds/

ENV NODE_ENV=production

CMD ["node", "--experimental-strip-types", "dist/index.js"]
