# Dev

install:
	npm install

dev-all:
	npm run dev --workspaces

dev-back:
	npm run dev --workspace=backend

dev-intr:
	npm run dev --workspace=interaction


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
