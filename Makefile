.PHONY: migrate migrate-fresh generate-key

# Запуск миграций для всех необходимых проектов (AdonisJS)
migrate:
	cd apps/backend && node ace migration:run

# Полный откат и запуск миграций заново (AdonisJS)
migrate-fresh:
	cd apps/backend && node ace migration:fresh

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