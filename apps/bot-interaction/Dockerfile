FROM node:24-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npx turbo run build

FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
COPY turbo.json ./

COPY apps/bot-interaction/package*.json ./apps/bot-interaction/
COPY packages/env/package*.json ./packages/env/
COPY packages/shared/package*.json ./packages/shared/

COPY packages/env/src/ ./packages/env/src/
COPY packages/shared/src/ ./packages/shared/src/

RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

WORKDIR /app/apps/bot-interaction

COPY --from=builder /app/apps/bot-interaction/dist ./dist/
COPY --from=builder /app/apps/bot-interaction/knexfile.ts ./
COPY --from=builder /app/apps/bot-interaction/migrations ./migrations/
COPY --from=builder /app/apps/bot-interaction/seeds ./seeds/

ENV NODE_ENV=production

CMD ["node", "--experimental-strip-types", "dist/index.js"]
