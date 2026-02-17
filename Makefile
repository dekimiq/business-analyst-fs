install:
	npm install

clean:
	rm -rf node_modules
	rm -rf backend/node_modules
	rm -rf interaction/node_modules

dev:
	docker compose up -d
	npm run dev

dev-down:
	docker compose down


# Code style

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
