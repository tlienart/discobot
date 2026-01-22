# Sandbox Plan: Lightweight Opencode Isolation

This plan outlines the architecture and implementation for sandboxing `opencode` sessions on macOS (Darwin) using a lightweight approach based on the `alcless` principle (Alcoholless) with "Blind Secret" hardening and stable channel-based workspaces.

## 1. Goals

- **Footgun Protection**: Prevent `opencode` sessions from accidentally deleting or modifying host system files or the discobot's own source code.
- **100% Blind Secrets**: Ensure that primary API keys (Google, OpenAI, Anthropic) never enter the sandbox environment. They remain in host memory and are injected by a secure proxy.
- **Full Shell Access**: Allow sessions to install and use tools (`git`, `gh`, `gcloud`, etc.) within their sandbox without affecting the host.
- **Workspace Persistence**: Support a persistent "workspace" folder where repositories and session data live, mapped to Discord channels.
- **Reliable Networking**: Bypass macOS user-isolation limits using Unix Domain Sockets for inter-process communication.

## 2. Architecture Diagram

```text
+-------------------------------------------------------------+
| Host Server (Main User)                                     |
|                                                             |
|  [ Discobot ] <---(Discord Bridge)---> [ Discord Channels ] |
|       |                                                     |
|       | [ Host-Side Bridge & Vault ]                        |
|       | (Holds GOOGLE_API_KEY, GH_TOKEN, etc.)              |
|       |                                                     |
|       | Spawns via `alclessctl`                             |
|       v                                                     |
|  +-------------------------------------------------------+  |
|  | Sandbox Environment (User: "alcless_...")             |  |
|  |                                                       |  |
|  |  +-------------------------------------------------+  |  |
|  |  | Workspace Folder (/Users/Shared/discobot-ws)    |  |  |
|  |  | (Shared via 0o777 permissions)                  |  |  |
|  |  |                                                 |  |  |
|  |  |  /project-alpha/  <-- (Mapped to #project-alpha)|  |  |
|  |  |  /project-beta/   <-- (Mapped to #project-beta) |  |  |
|  |  +-------------------------------------------------+  |  |
|  |                                                       |  |
|  |  [ Opencode Agent ]                                   |  |
|  |      |                                                |  |
|  |      +--> [ HTTP-to-Unix Bridge ]                     |  |
|  |      |    (Tunnels traffic to Host Vault)             |  |
|  |      |                                                |  |
|  |      +--> [ Host-Shim: gh/git ]                       |  |
|  |           (Forwards CLI commands to Host Bridge)      |  |
|  |                                                       |  |
|  +-------------------------------------------------------+  |
|                                                             |
+-------------------------------------------------------------+
```

## 3. Implementation Details

### A. Core Tooling: `alcless`

We use [alcless](https://github.com/AkihiroSuda/alcless) to create a dedicated sandbox user on macOS. This provides a strong boundary against host file access.

### B. Workspace Management (Stable Alias Model)

- **Root**: `/Users/Shared/discobot-workspace`.
- **Mapping**: Each Discord channel is mapped to a folder named after the channel (e.g., `#my-repo` -> `.../my-repo`).
- **Persistence**: SQLite state and files are stored in this stable folder, ensuring context is maintained across every agent turn.
- **Permissions**: The bot proactively creates the directory structure (including the deep `.local/share/opencode/storage` paths) and applies recursive `chmod 777` to ensure the sandbox user has full access.

### C. Blind Secret Injection (Host-Side Proxy)

To keep secrets safe:

1.  **Ghost Auth**: The sandbox contains an `auth.json` with valid-looking dummy keys.
2.  **Redirection**: The sandbox `opencode.json` is patched to point its `baseURL` for Google, OpenAI, and Anthropic to a local port inside the sandbox.
3.  **Tunneling**: A Python bridge inside the sandbox tunnels this local port to a shared Unix socket (`proxy.sock`) in `/Users/Shared`.
4.  **Vault**: The host bridge receives the request via the socket, strips the dummy keys, injects the real API keys from host memory, and forwards the request to the real provider via HTTPS.

### D. Secure CLI Tooling (Shims)

- Tools like `gh` and `git` are shimmed. When the agent runs `gh auth status`, it's running a Python script that forwards the command to the host bridge.
- The host bridge executes the real command with the `SANDBOX_GH_TOKEN` and returns the output.

### E. Cleanup & Reliability

- **Traps**: `entrypoint.sh` uses `trap EXIT` to ensure the background Python bridge is killed immediately after the agent turn.
- **Port Discovery**: The Python bridge uses a retry-loop to find a free port and signals it back to the entrypoint.

## 4. Verification

Use the provided script to verify the multi-turn stability and secret blindness:

```bash
export $(grep -v '^#' .env | xargs) && bun scripts/verify-stable-flow.ts
```

This script performs a "Write-then-Read" test across two independent process spawns to guarantee persistence.
