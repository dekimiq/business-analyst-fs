.PHONY: migrate migrate-fresh generate-key dev dev-backend

# Запуск миграций для всех необходимых проектов
migrate:
	docker compose run --rm backend node ace migration:run --force
	docker compose run --rm bot-interaction npm run migrate
	docker compose run --rm node-cron npm run migrate

# Полный откат и запуск миграций заново
migrate-fresh:
	docker compose run --rm backend node ace migration:fresh
	docker compose run --rm bot-interaction npm run migrate:rollback
	docker compose run --rm node-cron npm run migrate:rollback

# Генерация APP_KEY для бэкенда (AdonisJS)
generate-key:
	docker compose run --rm backend node ace generate:key

# Запуск только инфраструктуры (БД, Редис)
up:
	docker compose up -d postgres redis

# Полная сборка всех образов
build:
	docker compose build

# Запуск всего стека
dc-up:
	docker compose up -d

# Остановка контейнеров
dc-down:
	docker compose down

# Первичное развертывание: сборка, запуск, миграции и сиды
setup: build dc-up
	@echo "Waiting for database to be ready..."
	@sleep 10
	@echo "Running migrations..."
	-docker compose exec backend node ace.js migration:run
	docker compose exec bot-interaction node --experimental-strip-types /app/node_modules/.bin/knex migrate:latest --knexfile knexfile.ts
	docker compose exec node-cron node --experimental-strip-types /app/node_modules/.bin/knex migrate:latest --knexfile knexfile.ts
	@echo "Restarting services to ensure all configs are picked up..."
	docker compose restart backend bot-interaction node-cron ai-module
	@echo "Setup complete!"

# Остановка
down: dc-down

# linter & Prettier
check:
	npm run check

check-fix:
	npm run check-fix

# Запуск всех сервисов в dev-режиме
dev:
	npm run dev

# Запуск только бэкенда в dev-режиме
dev-backend:
	npm run dev --workspace=@project/backend