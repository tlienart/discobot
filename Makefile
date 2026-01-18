.PHONY: run test lint format clean clean-bot ci

# Binary path for bun
BUN := $(shell which bun 2>/dev/null || echo $(HOME)/.bun/bin/bun)

run:
	$(BUN) index.ts

test:
	$(BUN) test

lint:
	$(BUN) run lint

format:
	$(BUN) run format

clean:
	rm -f sessions.json sessions.test.json *.test.json logs/*.stdout logs/*.stderr logs/*.out

# Surgically kill only bot-managed sessions
clean-bot:
	pgrep -f "ses_" | xargs kill -9 || true

# Single source of truth for CI readiness
ci: format lint test
