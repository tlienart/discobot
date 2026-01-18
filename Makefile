.PHONY: run test lint format clean install-bun

# Try to find bun in PATH or default install location
BUN := $(shell which bun 2>/dev/null || echo $(HOME)/.bun/bin/bun)

run: install-bun
	@$(BUN) install
	@$(BUN) index.ts

install-bun:
	@if ! command -v $(BUN) >/dev/null 2>&1; then \
		echo "Bun not found. Installing Bun..."; \
		curl -fsSL https://bun.sh/install | bash; \
		echo "Bun installed successfully."; \
	fi

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
