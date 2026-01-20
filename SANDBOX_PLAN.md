# Sandbox & Security Architecture

This document defines the implementation of a container-free sandbox for OpenCode agent sessions using [Fence](https://github.com/Use-Tusk/fence).

## 1. Confinement Model: The "Air-Gapped Workspace"

Every agent process is confined to a dedicated `workspace/` subfolder. The bridge remains the trusted orchestrator in the root directory.

### Isolation Mechanism

- **CWD Enforcement**: `cwd: "./workspace"` for all subprocesses.
- **State Relocation**: To prevent the agent from reading the user's real home directory (`~/.local`, etc.), the bridge redirects all state paths to the sandbox:
  - `XDG_DATA_HOME=$PWD/workspace/.opencode/data`
  - `XDG_CONFIG_HOME=$PWD/workspace/.opencode/config`
  - `XDG_CACHE_HOME=$PWD/workspace/.opencode/cache`
- **Fence Wrapper**: The execution command is transformed:
  `opencode ...` -> `fence --settings .fence.json -- opencode ...`

## 2. Environment & Secret Management

The bridge acts as a security filter between the server's shell and the untrusted agent.

### Filtered Inheritance

The agent process will **not** inherit the full shell environment. Instead, it only receives:

1.  Standard paths (`PATH`, `HOME`, `USER`).
2.  XDG Overrides (defined above).
3.  Whitelist of secrets from `.env` (e.g., `GH_TOKEN`, `GCLOUD_PROJECT`).

### Default Secret Pass-list

- `GH_TOKEN` (GitHub collaboration)
- `GCLOUD_PROJECT` (Google Cloud context)
- `OPENAI_API_KEY` (Direct LLM calls)
- `ANTHROPIC_API_KEY` (Direct LLM calls)

_Note: Users can leave these empty in `.env` to prevent the agent from using these tools._

## 3. Security Policy (Fence)

### Filesystem Rules

- **Allow Write**: `./workspace`, `/private/tmp`. (Confined to sandbox and transient paths).
- **Allow Read**: `/` (Permissive read for system tool dependencies).
- **Strict Deny**: `../.env`, `../sessions.json`, `../src/`, `~/.ssh/`, `~/.aws/`, `~/.gitconfig`, `~/.gnupg/`. (Absolute lockdown of host secrets).

### Network Policy

Controlled via `SANDBOX_NETWORK_MODE`:

- `STRICT`: Only core developer domains (GitHub, Google, Wikipedia, NPM, PyPI).
- `MERGE` (Default): Core domains + User-provided `WHITE_LIST_DOMAINS`.
- `REPLACE`: User-provided domains only.

### Git Safety

Strict pattern matching to prevent accidental trunk pollution:

- **Denied**: `git checkout main`, `git checkout master`, `git push origin (main|master)`.
- **Customizable**: User can define `PRIMARY_BRANCH_PATTERNS` in `.env`.

## 4. Automated Maintenance (Garbage Collection)

The bridge performs a blocking cleanup sweep on every startup to prevent disk bloat and stale context.

1.  **TTL**: Defined by `SESSION_EXPIRY_HOURS` (Default: 48).
2.  **Scope**:
    - `logs/*.stdout` and `logs/*.stderr`.
    - `./workspace/.opencode/data/opencode/session/`.
    - Entries in `sessions.json`.
3.  **Transparency**: The bridge logs its progress to the terminal:
    `[Sandbox] GC sweep started... Pruned 12 stale sessions in 0.4s.`
