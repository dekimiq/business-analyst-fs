---
description: Структура проекта
---

# Структура проекта

```
./
├── .env                          # единый env для всего монорепо
├── .env.example                  # шаблон с описанием всех переменных
├── .gitignore
├── package.json                  # root — pnpm workspaces + turbo scripts
├── pnpm-workspace.yaml           # объявление workspaces
├── turbo.json                    # turborepo pipeline
├── tsconfig.base.json            # базовый TS config — все apps наследуются через extends
│
├── packages/                     # внутренние переиспользуемые пакеты
│   ├── env/                      # парсинг и валидация .env через zod — подключается во всех apps
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/                   # общие типы, интерфейсы, утилиты
│       ├── src/
│       │   ├── types/            # общие TypeScript типы (Lead, Report, User и тп)
│       │   └── utils/            # вспомогательные функции
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   ├── backend/                  # AdonisJS — основной API, интеграции, синхронизация
│   │   ├── app/
│   │   │   ├── controllers/
│   │   │   ├── models/           # Lucid модели
│   │   │   ├── services/         # интеграция Yandex API, AmoCRM
│   │   │   └── jobs/             # BullMQ воркеры синхронизации
│   │   ├── config/
│   │   ├── database/
│   │   │   └── migrations/
│   │   ├── start/
│   │   │   └── routes.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── ace                   # Adonis CLI entrypoint
│   │
│   ├── bot-interaction/          # Telegram + MAX бот — точка входа для клиента
│   │   ├── src/
│   │   │   ├── adapters/         # IBotAdapter, TelegramAdapter, MaxAdapter
│   │   │   ├── handlers/         # обработчики команд и сообщений
│   │   │   ├── workers/          # BullMQ воркер — подхватывает задачи отчётов
│   │   │   └── db/               # Knex — работа со схемой bot (users)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ai-module/                # AI оркестратор + аналитик
│   │   ├── src/
│   │   │   ├── orchestrator/     # читает RAG инструкции, координирует аналитика
│   │   │   ├── analyst/          # tool calling — HTTP запросы к backend API
│   │   │   ├── rag/              # работа с pgvector, embeddings, поиск по инструкциям
│   │   │   └── db/               # Knex — работа со схемой vectors
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── node-cron/                # планировщик задач — выставляет задачи в очереди
│       ├── src/
│       │   ├── jobs/             # определения cron задач (синхронизация, отчёты)
│       │   └── queues/           # подключения к BullMQ очередям (db0 + db1)
│       ├── package.json
│       └── tsconfig.json
│
└── infra/
    ├── nginx/
    │   └── nginx.conf
    └── postgres/
        └── init.sql              # создание схем, пользователей, расширений
```
