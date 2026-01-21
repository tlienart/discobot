# Sandbox Plan: Lightweight Opencode Isolation

This plan outlines the architecture and implementation for sandboxing `opencode` sessions on macOS (Darwin) using a lightweight approach based on the `alcless` principle (Alcoholless).

## 1. Goals

- **Footgun Protection**: Prevent `opencode` sessions from accidentally deleting or modifying host system files or the discobot's own source code.
- **Secret Isolation**: Ensure that secrets from the host user (e.g., SSH keys, AWS credentials) are not accessible to the sandboxed processes in plaintext.
- **Full Shell Access**: Allow sessions to install and use tools (`git`, `gh`, `gcloud`, etc.) within their sandbox without affecting the host.
- **Workspace Persistence**: Support a persistent "workspace" folder where repositories and session data live.
- **Secure Secret Usage**: Provide a mechanism for sandboxed processes to use secrets (e.g., for GitHub API or Git push) without ever seeing the raw tokens.

## 2. Architecture Diagram

```text
+-------------------------------------------------------------+
| Host Server (Main User: "bot-host")                         |
|                                                             |
|  [ Discobot ] <---(Discord Bridge)---> [ Discord Channels ] |
|       |                                                     |
|       | [ Host-Side Bridge Service ]                        |
|       | (Holds GH_TOKEN, AWS_KEYS, etc.)                    |
|       |                                                     |
|       | Spawns via `alclessctl shell`                       |
|       v                                                     |
|  +-------------------------------------------------------+  |
|  | Sandbox Environment (User: "alcless_bot-host_default") |  |
|  |                                                       |  |
|  |  +-------------------------------------------------+  |  |
|  |  | Workspace Folder (./workspace)                  |  |  |
|  |  |                                                 |  |  |
|  |  |  /repo1/                                        |  |  |
|  |  |  /repo2/                                        |  |  |
|  |  +-------------------------------------------------+  |  |
|  |                                                       |  |
|  |  [ Opencode Process ]                                 |  |
|  |      |                                                |  |
|  |      +--> [ Host-Shim: gh/git ]                       |  |
|  |           (Forwards to Host Bridge)                   |  |
|  |                                                       |  |
|  +-------------------------------------------------------+  |
|                                                             |
+-------------------------------------------------------------+
```

## 3. Implementation Details

### A. Core Tooling: `alcless`

We will use [alcless](https://github.com/AkihiroSuda/alcless) to manage the sandbox.

- **Why**: It's designed for macOS, lightweight, and uses standard Unix mechanisms (`su`, `sudo`, `rsync`) with proper `launchd` isolation.
- **Mechanism**: It creates a dedicated user account for the sandbox. It can "sync" the current directory to the sandbox user's environment, or run "plain" if we manage the workspace path ourselves.

### B. Workspace Management

- The **Workspace** will be a dedicated folder (e.g., `./workspace` or `/Users/Shared/discobot-workspace`).
- **Recommendation**: Use `/Users/Shared/discobot-workspace` when `USE_SANDBOX=true`. This avoids permission issues common on macOS when one user (the sandbox) tries to access another user's (the host) home directory.
- **Mapping**: Each session gets its own subdirectory. `SessionManager` ensures these are created with `0o777` permissions to be accessible by the sandbox user.

### C. Session Spawning

We use `alclessctl shell --workdir` to execute commands in the correct context:

```typescript
const sandboxCommand = [
  'alclessctl',
  'shell',
  '--plain',
  '--workdir',
  workspacePath,
  'default',
  'sh',
  '-c',
  `export PATH="${sandboxBinDir}:$PATH" && "${commandPath}" ${escapedArgs}`,
];
```

### D. Secure Secret Management (Host-Shims)

To prevent the agent from leaking plaintext secrets (like `GH_TOKEN`), we will NOT pass them as environment variables. Instead, we use a **Host-Shim** approach.

1.  **Host-Side Bridge**: A service running on the host that has access to the secrets.
2.  **Sandbox Shims**: Small binaries or scripts (e.g., `/usr/local/bin/gh`) in the sandbox that forward their arguments to the Host Bridge.
3.  **Command Execution**: The Host Bridge executes the real command on the host (with secrets injected) and returns the output to the shim.

### E. Isolated Tooling

Sessions can use `alcless brew` to install their own tools.

- These tools will be installed in the sandbox user's home directory.
- They will NOT interfere with the host's `/opt/homebrew`.

## 4. Generic Host-Shim Architecture

To make it easy to add new tools (like `gcloud` or `aws-cli`), we will use a generic shim pattern.

### 1. The Bridge Service (Host)

- Listens on a Unix Domain Socket (exposed to the sandbox).
- Maintains a whitelist of allowed commands.
- Automatically maps host environment variables (e.g. `GH_TOKEN`) to specific commands.

### 2. The Shim (Sandbox)

- A simple shell script placed in `/usr/local/bin/`.
- Template:
  ```bash
  #!/bin/bash
  # Send command name and args to host bridge
  exec-on-host "$(basename "$0")" "$@"
  ```

### 3. Setup Friction

- **User**: Just adds `GH_TOKEN=...` to the host `.env`.
- **Bot**: Automatically creates the shim in the sandbox during session initialization.

## 5. Testing Strategy

We will implement a standalone testing suite in `scripts/verify-sandbox.ts` to test the setup without the Discord bridge:

1. **Isolation Test**:
   - Attempt to read `~/.ssh/config` of the host user (Should Fail).
   - Attempt to write to `/usr/local/bin` (Should Fail).
   - Read/Write to the designated `workspace` (Should Succeed).
2. **Shim Test**:
   - Run `gh auth status` via the shim.
   - Verify it succeeds but `echo $GH_TOKEN` is empty in the sandbox.
3. **Tooling Test**:
   - Run `git --version` and `gh --version` within the sandbox.

## 6. Directory Structure & Mapping

To support multiple repositories and sessions, we will use the following structure:

```text
workspace/
  ├── .config/             # Shared sandbox configurations (gitconfig, etc.)
  ├── repo_a/              # A git repository
  │   └── .opencode/       # Local session data for repo_a
  └── repo_b/              # Another repository
```

**Mapping Logic**:

- Each Discord channel can be "bound" to a specific repository folder in the workspace.
- Commands sent to that channel will be executed with `cwd` set to that folder.
- Default behavior for new channels: Create a new subfolder in `workspace/`.

## 7. Dedicated Secret Isolation (Hardening)

To prevent the sandbox from accidentally using the host's primary credentials (e.g., your personal `GH_TOKEN`), we will implement **Dedicated Secret Isolation**.

### The Mechanism

1.  **Environment Variable Selection**: The `SessionManager` will look for a specific `SANDBOX_GH_TOKEN` in the `.env` file.
2.  **Bridge Injection**: This token is passed to the `HostBridge`. When the bridge executes a command, it explicitly sets `GH_TOKEN` using the value of `SANDBOX_GH_TOKEN`.
3.  **Override Priority**: The dedicated sandbox token will always override the host's default `GH_TOKEN` or system keyring during bridge execution.

### Verification (The "Stunt" Test)

We will use `scripts/verify-dedicated-token.ts` to prove isolation:

1.  Set `GH_TOKEN=TOKEN_A` (Host Primary).
2.  Set `SANDBOX_GH_TOKEN=TOKEN_B` (Sandbox Dedicated).
3.  Run `gh auth status` via the sandbox shim.
4.  **Verification**: The output must show `TOKEN_B` (or the account associated with it), confirming that `TOKEN_A` was never used or seen by the sandbox.

## 8. PR-Based Roadmap

The implementation will be carried out in the following sequential Pull Requests into the `alcoholless` branch.

### [PR #1] Baseline Sandbox Environment (Merged)

- Added `scripts/verify-alcless.sh`.

### [PR #2] Secret Injection & GH Authentication (Merged)

- Verified environment variable injection (Initial approach, now being superseded by Shims).

### [PR #3] Host-Side Bridge & Shims

- **Contents**: Implementation of the Host-Side Bridge Service and the generic shim mechanism for `gh` and `git`.
- **Goal**: Securely use `gh` inside the sandbox without exposing `GH_TOKEN` to the sandbox environment.
- **Verification**: Run `gh auth status` inside the sandbox; it should show logged in, while `env | grep GH_TOKEN` is empty.

### [PR #4] Bridge Integration with Mocked Agent

- **Contents**: `scripts/dumb-opencode.sh`, modifications to `src/opencode.ts` and `src/sessions.ts`.
- **Goal**: Connect the Discord bridge to the sandbox using a "dumb shell" wrapper.
- **Verification**: Send commands from Discord; verify they run as the sandbox user in the correct workspace.

### [PR #5] Workspace Logic & Persistence

- **Contents**: Logic for managing `workspace/` subfolders per channel/session.
- **Goal**: Ensure persistence and isolation between channels.

### [PR #6] Full Opencode Integration

- **Contents**: Switching `src/opencode.ts` to use the real `opencode` binary.
- **Goal**: Fully functional sandboxed `opencode`.
