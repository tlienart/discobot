.PHONY: run test lint format clean clean-bot ci

# Binary path for bun
BUN := $(HOME)/.bun/bin/bun

run:
	$(BUN) index.ts

test:
	$(BUN) test

lint:
	$(BUN) run lint

format:
	$(BUN) run format

clean:
	rm -f sessions.json sessions.test.json

# Surgically kill only bot-managed sessions
clean-bot:
	pgrep -f "ses_" | xargs kill -9 || true

ci: lint test
