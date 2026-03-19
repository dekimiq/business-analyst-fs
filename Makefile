.PHONY: migrate migrate-fresh generate-key

# Запуск миграций для всех необходимых проектов
migrate:
	cd apps/backend && node ace migration:run
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

# Запуск контейнера
up:
	docker compose up -d postgres redis

# Остановка контейнера
down:
	docker compose down

# linter & Prettier
check:
	npm run check

check-fix:
	npm run check-fix