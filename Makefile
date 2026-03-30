.PHONY: migrate migrate-fresh generate-key dev dev-backend

# Запуск миграций для всех необходимых проектов
migrate:
	cd apps/backend && node ace migration:run --force
	npm run migrate --workspace=@project/bot-interaction
	npm run migrate --workspace=@project/node-cron

# Полный откат и запуск миграций заново
migrate-fresh:
	cd apps/backend && node ace migration:fresh
	npm run migrate:rollback --workspace=@project/bot-interaction
	npm run migrate:rollback --workspace=@project/node-cron

# Запуск наполнения базы данных начальными данными
seed:
	cd apps/backend && node ace db:seed
	npm run seed --workspace=@project/bot-interaction
	npm run seed --workspace=@project/node-cron

# Генерация APP_KEY для бэкенда (AdonisJS)
generate-key:
	cd apps/backend && node ace generate:key

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