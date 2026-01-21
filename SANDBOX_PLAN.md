# Sandbox Plan: Lightweight Opencode Isolation

This plan outlines the architecture and implementation for sandboxing `opencode` sessions on macOS (Darwin) using a lightweight approach based on the `alcless` principle (Alcoholless).

## 1. Goals

- **Footgun Protection**: Prevent `opencode` sessions from accidentally deleting or modifying host system files or the discobot's own source code.
- **Secret Isolation**: Ensure that secrets from the host user (e.g., SSH keys, AWS credentials) are not accessible to the sandboxed processes.
- **Full Shell Access**: Allow sessions to install and use tools (`git`, `gh`, `gcloud`, etc.) within their sandbox without affecting the host.
- **Workspace Persistence**: Support a persistent "workspace" folder where repositories and session data live.
- **Secure Secret Injection**: Provide a mechanism to pass specific PAT tokens or service account keys to the sandboxed processes.

## 2. Architecture Diagram

```text
+-------------------------------------------------------------+
| Host Server (Main User: "bot-host")                         |
|                                                             |
|  [ Discobot ] <---(Discord Bridge)---> [ Discord Channels ] |
|       |                                                     |
|       | Spawns via `alclessctl shell`                       |
|       v                                                     |
|  +-------------------------------------------------------+  |
|  | Sandbox Environment (User: "alcless_bot-host_default") |  |
|  |                                                       |  |
|  |  +-------------------------------------------------+  |  |
|  |  | Workspace Folder (/Users/Shared/discobot-ws)    |  |  |
|  |  | (Shared via group permissions or alcless sync)  |  |  |
|  |  |                                                 |  |  |
|  |  |  /repo1/                                        |  |  |
|  |  |  /repo2/                                        |  |  |
|  |  +-------------------------------------------------+  |  |
|  |                                                       |  |
|  |  [ Opencode Process ] <--(Env: GH_TOKEN, etc.)        |  |
|  |      |                                                |  |
|  |      +--> [ Sub-shell / Tools (git, gh) ]             |  |
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

- The **Workspace** will be a dedicated folder (e.g., `./workspace`).
- **Storage Options**:
  1. **Sync Mode (Default alcless)**: `alcless` rsyncs the directory to the sandbox user's home, runs the command, and syncs back.
     - _Pros_: High isolation, no shared folder permission issues.
     - _Cons_: Slower for large repos, potential conflicts with concurrent sessions.
  2. **Shared Folder Mode (--plain)**: Use `--plain` and point to a folder that both the host and sandbox user can access.
     - _Pros_: Fast, no rsync overhead, supports concurrent sessions in different subfolders.
     - _Cons_: Requires careful permission setup (`chmod 770` + shared group).

**Recommendation**: Start with **Shared Folder Mode** using subfolders for each repository/session to maximize performance and support multiple concurrent sessions.

### C. Session Spawning

We will modify `src/opencode.ts` to wrap the `spawn` call:

```typescript
// Instead of: spawn(['opencode', ...args])
// We use:
const sandboxCommand = [
  'alclessctl',
  'shell',
  '--plain',
  'default',
  '--',
  'sh',
  '-c',
  `cd ${workspacePath} && /opt/homebrew/bin/opencode ${args.join(' ')}`,
];
```

### D. Secret Management

Secrets will be injected via environment variables during the spawn call.

1. **Config**: A `secrets.json` (or encrypted store) will map session/repo IDs to required secrets.
2. **Injection**: The `OpenCodeAgent` will be passed an `env` object containing the secrets.
3. **Safety**: We must ensure these secrets are NOT logged in the bridge's `stdout`/`stderr` logging (already partially handled by filtering, but we'll add explicit scrubbing).

### E. Isolated Tooling

Sessions can use `alcless brew` to install their own tools.

- These tools will be installed in the sandbox user's home directory.
- They will NOT interfere with the host's `/opt/homebrew`.

## 4. Testing Strategy

We will implement a standalone testing suite in `scripts/verify-sandbox.ts` to test the setup without the Discord bridge:

1. **Isolation Test**:
   - Attempt to read `~/.ssh/config` of the host user (Should Fail).
   - Attempt to write to `/usr/local/bin` (Should Fail).
   - Read/Write to the designated `workspace` (Should Succeed).
2. **Secret Test**:
   - Pass a dummy secret `SANDBOX_TEST_SECRET`.
   - Run a command that echoes it (Verifies injection).
   - Verify it doesn't appear in the host's process list or standard logs.
3. **Tooling Test**:
   - Run `git --version` and `gh --version` within the sandbox.
   - Verify they can be configured with the injected secrets.

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

## 7. Testing Strategy (Isolated)

We will provide a `scripts/sandbox-test.ts` utility that can be run directly:

```bash
# Test isolation
bun scripts/sandbox-test.ts --test isolation

# Test secret injection
bun scripts/sandbox-test.ts --test secrets --secret MY_KEY=value

# Test tool installation
bun scripts/sandbox-test.ts --test tools --install gh
```

## 8. Step-by-Step Implementation & Verification Plan

This section breaks down the implementation into small, verifiable chunks.

### Step 1: `alcless` Baseline Verification

- **Task**: Ensure `alcless` is correctly installed and the sandbox user is functional.
- **Verification**:
  ```bash
  alclessctl shell default -- whoami
  # Should return "alcless_bot-host_default" (or similar)
  ```

### Step 2: Secret Injection & Tooling (Isolated)

- **Task**: Test if we can pass a PAT token and use it with the `gh` CLI inside the sandbox.
- **Test Script**: `scripts/verify-gh-auth.ts`
  1.  Spawn `alclessctl shell --plain default` with `GH_TOKEN` in the environment.
  2.  Inside the shell: `brew install gh` (if not present) or use a pre-installed one.
  3.  Run `gh auth status`.
- **Verification**: The output should show the user associated with the PAT token, confirming environment variable inheritance works through the `su/sudo` layers of `alcless`.

### Step 3: Dumb Shell Wrapper (Mock Opencode)

- **Task**: Create a simple shell script `scripts/dumb-opencode.sh` that mimics the `opencode run` interface (accepting a prompt and returning output) but simply executes it as a shell command.
- **Goal**: Decouple sandbox issues from `opencode` internal complexity.
- **Verification**:
  1.  Point `src/opencode.ts` to `scripts/dumb-opencode.sh`.
  2.  Send a message from Discord: `ls -la`.
  3.  Verify the bridge returns the directory listing of the _sandbox workspace_, not the host.

### Step 4: Boundary & Persistence Checks

- **Task**: Run a suite of scripts to verify the "walls" of the sandbox.
- **Verification**:
  - `ls ~/.ssh` -> Permission Denied.
  - `touch ./workspace/test.txt` -> Success.
  - Exit session, start new session, `ls ./workspace/test.txt` -> Success (Persistence check).

### Step 5: Full `opencode` Integration

- **Task**: Switch the bridge to use the real `opencode` binary, wrapped in `alcless`.
- **Verification**:
  1.  Connect to a Discord channel.
  2.  Ask it to "clone this repo and check the git log".
  3.  Verify it uses the injected `GH_TOKEN` and clones into the sandboxed `workspace/`.

## 10. PR-Based Roadmap

The implementation will be carried out in the following sequential Pull Requests into the `alcoholless` branch. Each PR must pass its specific verification steps before being merged.

### [PR #1] Baseline Sandbox Environment

- **Contents**: `scripts/verify-alcless.sh`.
- **Goal**: Ensure `alcless` is installed and the `alclessctl` command works for the current user.
- **Verification**: Run `./scripts/verify-alcless.sh`. It should output the sandbox username and verify that the sandbox user exists.

### [PR #2] Secret Injection & GH Authentication

- **Contents**: `scripts/verify-gh-auth.ts`, configuration for secret mapping.
- **Goal**: Demonstrate that a `GH_TOKEN` passed from the host correctly authenticates the `gh` CLI inside the sandbox.
- **Verification**: Run `bun scripts/verify-gh-auth.ts`. Success means `gh auth status` returns a valid login.

### [PR #3] Bridge Integration with Mocked Agent

- **Contents**: `scripts/dumb-opencode.sh`, modifications to `src/opencode.ts` and `src/sessions.ts`.
- **Goal**: Connect the Discord bridge to the sandbox using a "dumb shell" wrapper.
- **Verification**: Send a command like `ls -la` from Discord. The bot should reply with the directory listing of the sandbox workspace.

### [PR #4] Workspace Logic & Persistence

- **Contents**: Logic for managing `workspace/` subfolders per channel/session. `scripts/test-persistence.ts`.
- **Goal**: Ensure files created in one turn persist in the next, and that sessions are isolated into their own folders.
- **Verification**: Create a file via Discord, restart the bot, and verify the file is still accessible in that channel's session.

### [PR #5] Full Opencode Integration

- **Contents**: Switching `src/opencode.ts` to use the real `opencode` binary.
- **Goal**: Fully functional sandboxed `opencode` with secret injection.
- **Verification**: Ask the bot to perform a complex task (e.g., "Check the status of this repo and create a branch") and verify it succeeds within the sandbox.
