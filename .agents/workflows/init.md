---
description: Инструкции по инициализации проекта
---

# Инициализация проекта

## Тип репозитория

**Turborepo монорепо** с pnpm workspaces. Все приложения живут в `apps/`, переиспользуемые пакеты в `packages/`. Сборка, линт и type-check координируются через `turbo.json` из корня.

---

## Корневые файлы

### `package.json`

```json
{
  "name": "analytics-monorepo",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "type-check": "turbo run type-check",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.3.3",
    "typescript": "^5.7.2",
    "@types/node": "^22.10.0"
  }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "type-check": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    }
  }
}
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

---

## `.env` — расположение и структура

Лежит в **корне монорепо** (`/.env`). Один файл на весь проект.

```env
# === GENERAL ===
TZ=Europe/Moscow
NODE_ENV=development

# === DATABASE — PostgreSQL ===
DB_HOST=postgres
DB_PORT=5432
DB_NAME=analytics

DB_USER_BACKEND=backend_user
DB_PASSWORD_BACKEND=secret

DB_USER_BOT=bot_user
DB_PASSWORD_BOT=secret

DB_USER_AI=ai_user
DB_PASSWORD_AI=secret

# === REDIS ===
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB_BACKEND=0
REDIS_DB_BOT=1

# === YANDEX ===
YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
YANDEX_TOKEN=

# === AMOCRM ===
AMOCRM_DOMAIN=
AMOCRM_CLIENT_ID=
AMOCRM_CLIENT_SECRET=
AMOCRM_TOKEN=

# === AI ===
OPENROUTER_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=

# === BOT ===
TELEGRAM_BOT_TOKEN=
MAX_BOT_TOKEN=

# === INTERNAL ===
BACKEND_API_URL=http://backend:3333
```

---

## Docker Compose — сервисы

```yaml
# docker-compose.yml (корень)
services:
  postgres:
    image: pgvector/pgvector:pg16
    env_file: .env
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_root
      TZ: ${TZ}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - '5432:5432'

  redis:
    image: redis:7-alpine
    command: redis-server --databases 16
    environment:
      TZ: ${TZ}
    ports:
      - '6379:6379'

  backend:
    build: ./apps/backend
    env_file: .env
    environment:
      TZ: ${TZ}
    depends_on:
      - postgres
      - redis
    ports:
      - '3333:3333'

  bot-interaction:
    build: ./apps/bot-interaction
    env_file: .env
    environment:
      TZ: ${TZ}
    depends_on:
      - postgres
      - redis

  ai-module:
    build: ./apps/ai-module
    env_file: .env
    environment:
      TZ: ${TZ}
    depends_on:
      - postgres
      - backend

  node-cron:
    build: ./apps/node-cron
    env_file: .env
    environment:
      TZ: ${TZ}
    depends_on:
      - redis

  nginx:
    image: nginx:alpine
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf
    ports:
      - '80:80'
    depends_on:
      - backend

volumes:
  postgres_data:
```

---

## Стек по модулям и пакеты

### `packages/env`

> Валидация и экспорт переменных окружения. Подключается во всех apps.

| Пакет    | Версия  | Назначение             |
| -------- | ------- | ---------------------- |
| `zod`    | ^3.24.0 | валидация схемы env    |
| `dotenv` | ^16.4.7 | загрузка .env из корня |

---

### `packages/shared`

> Общие TypeScript типы и утилиты.

| Пакет        | Версия   | Назначение |
| ------------ | -------- | ---------- |
| `typescript` | via root | —          |

---

### `apps/backend` — AdonisJS

> Основной API сервер. Интеграции с Yandex и AmoCRM. Синхронизация данных. Предоставляет HTTP эндпоинты для AI-модуля.

| Пакет                | Версия    | Назначение                                 |
| -------------------- | --------- | ------------------------------------------ |
| `@adonisjs/core`     | ^6.14.0   | ядро фреймворка                            |
| `@adonisjs/lucid`    | ^21.3.0   | ORM, работа со схемой `backend`            |
| `@adonisjs/redis`    | ^9.1.0    | Redis клиент                               |
| `bullmq`             | ^5.34.0   | очереди, воркеры синхронизации (db0)       |
| `@vinejs/vine`       | ^2.1.0    | валидация входящих данных                  |
| `axios`              | ^1.7.9    | HTTP запросы к Yandex / AmoCRM             |
| `adonis-autoswagger` | ^3.x      | автогенерация Swagger UI из роутов и типов |
| `@japa/runner`       | ^3.x      | тестовый фреймворк (встроен в Adonis)      |
| `@japa/api-client`   | ^2.x      | реальные HTTP запросы в тестах, без моков  |
| `@japa/assert`       | ^3.x      | assertions в тестах                        |
| `@package/env`       | workspace | env переменные                             |
| `@package/shared`    | workspace | общие типы                                 |

TS config: `extends: "../../tsconfig.base.json"` + `experimentalDecorators: true`, `emitDecoratorMetadata: true`

---

### `apps/bot-interaction` — Telegram + MAX

> Точка входа для клиента. Отправляет отчёты, принимает команды. Хранит пользователей в схеме `bot`.

| Пакет                 | Версия    | Назначение             |
| --------------------- | --------- | ---------------------- |
| `grammy`              | ^1.31.0   | Telegram бот           |
| `@maxhub/max-bot-api` | ^1.x      | MAX мессенджер бот     |
| `bullmq`              | ^5.34.0   | воркер отчётов (db1)   |
| `knex`                | ^3.1.0    | работа со схемой `bot` |
| `pg`                  | ^8.13.1   | PostgreSQL драйвер     |
| `@package/env`        | workspace | env переменные         |
| `@package/shared`     | workspace | общие типы             |

TS config: `extends: "../../tsconfig.base.json"`

---

### `apps/ai-module` — AI оркестратор

> Оркестратор + аналитик. RAG инструкции. Tool calling через HTTP к backend.

| Пакет             | Версия    | Назначение                                          |
| ----------------- | --------- | --------------------------------------------------- |
| `ai`              | ^4.1.0    | Vercel AI SDK — оркестрация, tool calling, стриминг |
| `@ai-sdk/openai`  | ^1.1.0    | провайдер OpenAI / OpenRouter                       |
| `@ai-sdk/google`  | ^1.1.0    | провайдер Gemini                                    |
| `knex`            | ^3.1.0    | работа со схемой `vectors`                          |
| `pg`              | ^8.13.1   | PostgreSQL драйвер                                  |
| `pgvector`        | ^0.2.0    | pgvector хелперы для knex/pg                        |
| `@package/env`    | workspace | env переменные                                      |
| `@package/shared` | workspace | общие типы                                          |

TS config: `extends: "../../tsconfig.base.json"`

---

### `apps/node-cron` — планировщик

> Выставляет задачи в BullMQ очереди по расписанию. Не выполняет задачи сам — только триггерит.

| Пакет          | Версия    | Назначение                             |
| -------------- | --------- | -------------------------------------- |
| `node-cron`    | ^3.0.3    | планировщик по расписанию              |
| `bullmq`       | ^5.34.0   | добавление задач в очереди (db0 + db1) |
| `ioredis`      | ^5.4.1    | Redis клиент для BullMQ                |
| `@package/env` | workspace | env переменные                         |

TS config: `extends: "../../tsconfig.base.json"`
