# Server Setup & Sandbox Management

## 1. Prerequisites

### Install Fence

Fence is the lightweight wrapper that enforces filesystem and network rules.

```bash
curl -fsSL https://raw.githubusercontent.com/Use-Tusk/fence/main/install.sh | sh
```

### System Requirements

- **macOS**: `sandbox-exec` (Built-in).
- **Linux**: Install `bubblewrap` and `socat`.

## 2. Configuration (`.env`)

Add these variables to control the security level:

```env
# --- Sandbox Settings ---
USE_SANDBOX=true
SANDBOX_WORKSPACE_DIR=./workspace

# --- Git Protection ---
# Comma-separated patterns of branches to protect
PRIMARY_BRANCH_PATTERNS=main,master,production

# --- Network Policy ---
# Modes: MERGE (Defaults + Custom), REPLACE (Custom only), STRICT (Defaults only)
SANDBOX_NETWORK_MODE=MERGE
WHITE_LIST_DOMAINS=my-api.com,internal-docs.io

# --- Maintenance ---
# Delete sessions and logs older than this many hours
SESSION_EXPIRY_HOURS=48
```

## 3. Operating the Sandbox

### Authentication

Since the sandbox cannot see your host's `~/.config`, you have two ways to provide credentials to tools like `gh`:

1.  **Environment (Recommended)**: Set the token in your shell before running `make run`. The bridge will forward it.
2.  **Within Session**: You can run `gh auth login` inside an agent session. The credentials will be saved inside `workspace/.opencode/config`.

### Manual Cleanup

To completely reset the agent's world (remove all cloned repos and data):

```bash
# This removes the workspace/ contents but keeps the folder
make clean-workspace
```

## 4. Understanding the Boundaries

| Feature              | Covered? | Note                                            |
| :------------------- | :------: | :---------------------------------------------- |
| **Parent Directory** |  ✅ YES  | Agent cannot read `.env` or `src/`.             |
| **Main Branch**      |  ✅ YES  | Agent is blocked from pushing to `main`.        |
| **Secrets**          |  ✅ YES  | Agent only sees variables you explicitly allow. |
| **Disk Space**       |  ❌ NO   | Agent could theoretically fill the disk.        |
| **CPU/RAM**          |  ❌ NO   | Agent could theoretically cause high load.      |

```

```
