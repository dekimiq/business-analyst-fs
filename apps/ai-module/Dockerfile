FROM node:24-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npx turbo run build

FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
COPY turbo.json ./

COPY apps/ai-module/package*.json ./apps/ai-module/
COPY packages/env/package*.json ./packages/env/
COPY packages/shared/package*.json ./packages/shared/

COPY packages/env/src/ ./packages/env/src/
COPY packages/shared/src/ ./packages/shared/src/

RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/apps/ai-module/dist ./apps/ai-module/dist/
COPY --from=builder /app/apps/ai-module/instructions ./apps/ai-module/instructions/
COPY --from=builder /app/apps/ai-module/src/prompts ./apps/ai-module/dist/prompts/

ENV NODE_ENV=production

WORKDIR /app/apps/ai-module
CMD ["node", "--experimental-strip-types", "dist/index.js"]
