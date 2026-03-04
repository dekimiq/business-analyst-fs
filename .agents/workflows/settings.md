---
description: Инструкции по настройкам и конфигурации проекта
---

# Настройки и детали конфигурации

## ENV — как работает

`.env` лежит в корне монорепо. Каждое приложение **не имеет своего `.env`**. Загрузка происходит через пакет `packages/env`, который:

1. Находит `.env` относительно корня монорепо через `path.resolve`
2. Загружает его через `dotenv`
3. Парсит и валидирует через `zod`
4. Экспортирует типизированный объект `env`

```typescript
// packages/env/src/index.ts
import { config } from 'dotenv'
import { resolve } from 'path'
import { z } from 'zod'

// Поднимаемся из packages/env/src/ до корня монорепо
config({ path: resolve(__dirname, '../../../.env') })

const schema = z.object({
  TZ: z.string().default('Europe/Moscow'),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().default(5432),
  // ... все переменные
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ ENV validation failed:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1) // падаем сразу, не даём приложению стартовать с кривыми данными
}

export const env = parsed.data
export type Env = typeof env
```

Использование в любом приложении:

```typescript
import { env } from '@project/env'

console.log(env.DB_HOST) // типизировано, автодополнение работает
console.log(env.TZ)
```

В `docker-compose.yml` переменные передаются через `env_file: .env` — Docker читает тот же файл. Дублирования нет.

---

## TypeScript — цепочка наследования

Все `tsconfig.json` наследуются от корневого `tsconfig.base.json` через `extends`.

```
tsconfig.base.json (корень)
    ├── packages/env/tsconfig.json        → extends: "../../tsconfig.base.json"
    ├── packages/shared/tsconfig.json     → extends: "../../tsconfig.base.json"
    ├── apps/bot-interaction/tsconfig.json → extends: "../../tsconfig.base.json"
    ├── apps/ai-module/tsconfig.json      → extends: "../../tsconfig.base.json"
    ├── apps/node-cron/tsconfig.json      → extends: "../../tsconfig.base.json"
    └── apps/backend/tsconfig.json        → extends: "../../tsconfig.base.json"
                                            + experimentalDecorators: true
                                            + emitDecoratorMetadata: true
```

Пример для обычного приложения:

```json
// apps/ai-module/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

Пример для AdonisJS (дополнительные опции для декораторов):

```json
// apps/backend/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "outDir": "./build",
    "rootDir": "./"
  },
  "include": ["**/*"],
  "exclude": ["node_modules", "build"]
}
```

---

## Package.json — скрипты по модулям

### `apps/backend/package.json`

AdonisJS использует собственный CLI `node ace`. Стандартные команды `tsc` не используются для запуска.

```json
{
  "name": "@project/backend",
  "scripts": {
    "dev": "node ace serve --watch",
    "build": "node ace build",
    "start": "node build/bin/server.js",
    "migration:run": "node ace migration:run",
    "migration:rollback": "node ace migration:rollback",
    "type-check": "tsc --noEmit"
  }
}
```

### `apps/bot-interaction/package.json`

```json
{
  "name": "@project/bot-interaction",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "type-check": "tsc --noEmit"
  }
}
```

### `apps/ai-module/package.json`

```json
{
  "name": "@project/ai-module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "type-check": "tsc --noEmit"
  }
}
```

### `apps/node-cron/package.json`

```json
{
  "name": "@project/node-cron",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "type-check": "tsc --noEmit"
  }
}
```

### `packages/env/package.json`

```json
{
  "name": "@project/env",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

> В dev-режиме через `tsx` компиляция не нужна — экспорт напрямую из `.ts` файла. В prod — через сборку.

---

## Redis — изоляция очередей

Один контейнер Redis, две логические базы данных.

```typescript
// apps/node-cron/src/queues/index.ts
import { Queue } from 'bullmq'
import { env } from '@project/env'

// Очередь синхронизации — backend воркер слушает db:0
export const syncQueue = new Queue('sync', {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB_BACKEND, // = 0
  },
})

// Очередь отчётов — bot воркер слушает db:1
export const reportsQueue = new Queue('reports', {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB_BOT, // = 1
  },
})
```

BullMQ воркеры в backend и bot-interaction зеркально используют те же `db` номера — тогда задача из cron попадает ровно к нужному воркеру.

---

## PostgreSQL — схемы и пользователи

```sql
-- infra/postgres/init.sql

-- Расширения
CREATE EXTENSION IF NOT EXISTS vector;

-- Схемы
CREATE SCHEMA IF NOT EXISTS backend;
CREATE SCHEMA IF NOT EXISTS bot;
CREATE SCHEMA IF NOT EXISTS vectors;

-- Пользователи с изолированными правами
CREATE USER backend_user WITH PASSWORD 'secret_backend';
GRANT CONNECT ON DATABASE analytics TO backend_user;
GRANT USAGE, CREATE ON SCHEMA backend TO backend_user;

CREATE USER bot_user WITH PASSWORD 'secret_bot';
GRANT CONNECT ON DATABASE analytics TO bot_user;
GRANT USAGE, CREATE ON SCHEMA bot TO bot_user;

CREATE USER ai_user WITH PASSWORD 'secret_ai';
GRANT CONNECT ON DATABASE analytics TO ai_user;
GRANT USAGE, CREATE ON SCHEMA vectors TO ai_user;
GRANT USAGE ON SCHEMA backend TO ai_user;          -- только чтение для аналитика
GRANT SELECT ON ALL TABLES IN SCHEMA backend TO ai_user;
```

Каждое приложение подключается под своим пользователем — физически не может затронуть чужую схему.

---

## Knex — подключение в bot и ai-module

```typescript
// apps/bot-interaction/src/db/index.ts
import knex from 'knex'
import { env } from '@project/env'

export const db = knex({
  client: 'pg',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER_BOT,
    password: env.DB_PASSWORD_BOT,
    database: env.DB_NAME,
  },
  searchPath: ['bot'], // все запросы по умолчанию в схему bot
})
```

```typescript
// apps/ai-module/src/db/index.ts
import knex from 'knex'
import { env } from '@project/env'

export const db = knex({
  client: 'pg',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER_AI,
    password: env.DB_PASSWORD_AI,
    database: env.DB_NAME,
  },
  searchPath: ['vectors', 'backend'], // сначала vectors, потом backend (только SELECT)
})
```

---

## Lucid — подключение в AdonisJS backend

```typescript
// apps/backend/config/database.ts
import { defineConfig } from '@adonisjs/lucid'
import { env } from '@project/env'

export default defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER_BACKEND,
        password: env.DB_PASSWORD_BACKEND,
        database: env.DB_NAME,
        searchPath: ['backend'],
      },
    },
  },
})
```

---

## Синхронизация в 3 ночи — флаг недоступности

Во время синхронизации backend недоступен для AI-модуля. Управляется флагом в Redis.

```typescript
// apps/backend/app/jobs/SyncJob.ts — начало синхронизации
await redis.set('sync:in_progress', '1', 'EX', 7200) // TTL 2 часа — страховка

// apps/backend/app/jobs/SyncJob.ts — конец синхронизации
await redis.del('sync:in_progress')
```

```typescript
// apps/ai-module/src/utils/checkSync.ts
import { env } from '@project/env'
import Redis from 'ioredis'

const redis = new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT, db: 0 })

export async function isSyncInProgress(): Promise<boolean> {
  const flag = await redis.get('sync:in_progress')
  return flag === '1'
}
```

Оркестратор проверяет флаг перед генерацией отчёта. Если синхронизация идёт — задача откладывается через BullMQ `delay`.

---

## Vercel AI SDK — подключение провайдеров

```typescript
// apps/ai-module/src/providers.ts
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { env } from '@project/env'

// OpenRouter — через OpenAI совместимый endpoint
export const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: env.OPENROUTER_API_KEY,
})

// Gemini — напрямую
export const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY,
})

// Модели
export const orchestratorModel = openrouter('anthropic/claude-3.5-sonnet')
export const analystModel = openrouter('google/gemini-flash-1.5')
```

HTTP инструменты аналитика:

```typescript
// apps/ai-module/src/analyst/tools.ts
import { tool } from 'ai'
import { z } from 'zod'
import { env } from '@project/env'

export const analystTools = {
  getLeadStats: tool({
    description: 'Получить статистику лидов за период',
    parameters: z.object({
      dateFrom: z.string().describe('Дата начала YYYY-MM-DD'),
      dateTo: z.string().describe('Дата конца YYYY-MM-DD'),
    }),
    execute: async ({ dateFrom, dateTo }) => {
      const res = await fetch(
        `${env.BACKEND_API_URL}/api/leads/stats?from=${dateFrom}&to=${dateTo}`,
      )
      return res.json()
    },
  }),

  getAdStats: tool({
    description: 'Получить статистику рекламных кампаний',
    parameters: z.object({ dateFrom: z.string(), dateTo: z.string() }),
    execute: async ({ dateFrom, dateTo }) => {
      const res = await fetch(`${env.BACKEND_API_URL}/api/ads/stats?from=${dateFrom}&to=${dateTo}`)
      return res.json()
    },
  }),
}
```
