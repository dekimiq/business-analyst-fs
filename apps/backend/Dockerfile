FROM node:24-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npx turbo run build

FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
COPY turbo.json ./

COPY apps/backend/package*.json ./apps/backend/
COPY packages/env/package*.json ./packages/env/
COPY packages/shared/package*.json ./packages/shared/

COPY packages/env/src/ ./packages/env/src/
COPY packages/shared/src/ ./packages/shared/src/

RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/apps/backend/build ./apps/backend/build/

ENV NODE_ENV=production
EXPOSE 3333

WORKDIR /app/apps/backend/build
CMD ["node", "--experimental-strip-types", "bin/server.js"]
