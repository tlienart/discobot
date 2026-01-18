.PHONY: run test lint format clean

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
	pgrep -f "discobot_" | xargs kill -9 || true
