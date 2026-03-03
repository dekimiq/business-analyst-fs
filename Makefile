
# =============================================================================
# Infrastructure
# =============================================================================

up:
	docker compose up -d

down:
	docker compose down

# =============================================================================
# Database
# =============================================================================

migrate:
	cd backend && node --env-file=../.env --env-file=.env ace migration:run --force

migrate-fresh:
	cd backend && node --env-file=../.env --env-file=.env ace migration:fresh --force

# =============================================================================
# Development
# =============================================================================

# Первичная инициализация бэкенда (первый запуск после клона).
# Необходим make migrate.

# Запуск рабочего окружения.
# migration:run идемпотентен — безопасно запускать каждый раз.
dev: up migrate
	npm run dev

# Только очередь (полезно для отладки воркера отдельно от сервера)
queue:
	cd backend && node --env-file=../.env --env-file=.env ace queue:listen

# Полный сброс: пересоздать БД и запустить dev
dev-fresh: up migrate-fresh
	npm run dev

# Запуск тестов
test:
	cd backend && node --env-file=../.env --env-file=.env ace test $(ARGS)

# test-slow:
# 	cd backend && node --env-file=../.env --env-file=.env ace test -- --suite=unit $(ARGS)

test-fast:
	cd backend && node --env-file=../.env --env-file=.env ace test --tags="~@slow"

# =============================================================================
# Dependencies
# =============================================================================

install:
	npm install

clean:
	rm -rf node_modules
	rm -rf backend/node_modules
	rm -rf interaction/node_modules

# =============================================================================
# Code style
# =============================================================================

lint:
	npm run lint

lint-fix:
	npm run lint:fix

format:
	npm run format

format-fix:
	npm run format:fix

check:
	npm run lint
	npm run format

fix:
	npm run lint:fix
	npm run format:fix
