# Project Plan: Discord-OpenCode Bridge

This project aims to build a portable bridge between Discord and multiple `opencode` sessions running on a Mac server.

## Goals

- **Remote Monitoring**: View summaries and prompts from `opencode` sessions in Discord.
- **Remote Interaction**: Send messages from Discord to be injected as input into `opencode`.
- **Long-Running Sessions**: Maintain context across multiple turns using `opencode` session IDs.
- **Sandbox Isolation**: Map Discord channels to native macOS user sandboxes using `sbx`.
- **Session Lifecycle Management**: Automatically create sandboxes on first use and wipe them when channels are closed.
- **Noise Reduction**: Use structured JSON events to filter out "Chain of Thought" (CoT) and only show actionable output.

## Architecture

### 1. Bridge Service (Bun/TypeScript)

- **Discord Client**: Handles slash commands (`/new`, `/mode`, etc.) and message events.
- **Session Manager**: Maps Discord Channel IDs to `sbx` sandbox instances. Handles creation and deletion of macOS users.
- **OpenCode Agent**: Spawns `opencode` via `sbx exec <instance>`.
- **Event Parser**: Consumes `opencode --format json` stream to track progress and extract output.

### 2. Sandbox Integration (`sbx`)

- **Host Bridge**: `sbx` runs a host-side bridge to inject secrets (`GITHUB_TOKEN`, LLM API Keys) without exposing them to the sandbox.
- **Shims**: `sbx` provides shims for `git`, `gh`, and `opencode` inside the sandbox that communicate with the host bridge.

---

## Roadmap: `sbx` Integration

### Phase 1: Cleanup & Preparation

- [ ] Remove legacy `src/sandbox/` implementation (manager, bridge, shims).
- [ ] Remove `alclessctl` references from `OpenCodeAgent`.
- [ ] Clean up `SessionManager` from custom workspace management.

### Phase 2: Session Mapping & Lifecycle

- [ ] Implement `sbx` lifecycle in `SessionManager`:
  - `prepareSession(channelId)` -> `sbx create <id>`.
  - `removeSession(channelId)` -> `sbx delete <id>`.
- [ ] Map Discord Channel IDs to `sbx` instance names (e.g., `sbx_123456789`).
- [ ] Implement `channelDelete` listener to trigger sandbox wiping.

### Phase 3: Execution via Sbx

- [ ] Update `OpenCodeAgent` to spawn `sbx exec <instance> "opencode ..."`
- [ ] Ensure `stdout`/`stderr` piping works through `sudo su`.
- [ ] Verify environment variables for `sbx` are available on the host.

### Phase 4: Persistence & Recovery

- [ ] Implement `sbx list` check in `prepareSession` to reuse existing sandboxes if the bridge restarts.
- [ ] Verify that `opencode` session IDs still work correctly inside the `sbx` home directory.

---

## Testing Protocol

### 1. Pre-End-to-End (Mocked/Local)

- **Sbx Command Test**: Run a script that verifies `sbx exec` can run `whoami` and return the correct sandbox user.
- **Lifecycle Test**: Verify `prepareSession` creates a user and `removeSession` deletes it on the host.
- **JSON Stream Test**: Verify that JSON events from `opencode` are correctly received through the `sbx exec` pipe.

### 2. End-to-End (Discord)

- **First Message**: Send message -> verify `sbx create` and `sbx exec` logs.
- **Authenticated Task**: Ask bot to `gh auth status` -> verify it shows host-level auth.
- **Multi-turn persistence**: Perform a task, restart bridge, continue task -> verify state is preserved in the sandbox.
- **Wipe on Close**: Delete Discord channel -> verify `sbx delete` logs and user removal.

## Success Criteria

- Codebase simplified (no internal bridge/shim logic).
- Sandboxes are fully isolated native macOS users.
- Discord channels map 1:1 to sandboxes.
- Secrets never exposed inside the sandbox.
