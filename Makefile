.PHONY: setup build spec lint check test bench audit ci

# Output format of `make check`: text locally, github (annotations) in CI.
FORMAT ?= text

setup:
	npm ci

build:
	npm run build

# Regenerate openapi/openapi.yaml from spec/ and lint it (commit the result).
spec: build
	node dist/src/cli.js build

# Strict TypeScript (no emit) and TypeSpec formatting.
lint:
	npm run lint

# The committed OpenAPI file matches a fresh TypeSpec compile and passes the style guide.
check: build
	node dist/src/cli.js check --format $(FORMAT)

# Unit, randomized, CLI and end-to-end tests (single process).
test:
	npm test

# Compile and lint time, first-draft baseline, seeded-violation detection rate.
bench: build
	node dist/src/measure.js

# Known vulnerabilities in npm dependencies (any severity fails).
audit:
	npm audit

ci: setup lint check test
