# Discord-OpenCode Bridge 🚀

The **Discord-OpenCode Bridge** allows you to control and monitor multiple `opencode` sessions on your computer directly from Discord.

### Why is this useful?

- **Remote Control:** Run `opencode` tasks from your phone, tablet, or another computer while you're away from your desk.
- **Session Persistence:** Start a task at home and check its progress or provide input from anywhere.
- **Multitasking:** Manage several independent agent sessions simultaneously, each in its own dedicated Discord channel.
- **Sandboxed Security:** Runs in an isolated environment where secrets are hidden and host files are protected using macOS native user accounts.

---

## ⚡ Quick Start

### 1. Prerequisites

- **OpenCode:** Ensure `opencode` is installed on your machine.
- **Sbx:** Required for sandboxing on macOS. Clone `tlienart/sbx` into the root folder.
- **Make:** Most systems have this by default.

### 2. Sandbox Setup (macOS only)

The bridge uses `sbx` to manage isolated macOS user sessions.

1.  **Clone Sbx**:

    ```bash
    git clone https://github.com/tlienart/sbx.git sbx
    cd sbx && bun install
    ```

2.  **Grant Permissions**:
    Your terminal (or the process running the bridge) must have **Full Disk Access** granted in System Settings > Privacy & Security.

3.  **Warp Sudo**:
    Run `sudo -v` before starting the bridge to ensure the sandbox creation doesn't hang waiting for a password.

### 3. Configuration

Create a `config.json` file in the root of this project:

```json
{
  "discord": {
    "token": "your_bot_token",
    "clientId": "your_client_id",
    "guildId": "your_guild_id",
    "sessionDb": "sessions.json"
  }
}
```

Set your secrets in your environment (e.g. in your `.zshrc` or via export):

- `SBX_GITHUB_TOKEN`: For GitHub authentication.
- `SBX_GOOGLE_API_KEY`: For Gemini/Google LLMs.
- `SBX_OPENAI_API_KEY`: For OpenAI LLMs.
- `SBX_ANTHROPIC_API_KEY`: For Anthropic LLMs.

### 4. Run the Bridge

```bash
make run
```

---

## 📜 Commands

The bridge uses Discord Slash Commands for all interactions.

### 🛠️ Configuration & Setup

- **`/setup [category]`**: Sets the Discord category where the bot will create new session channels.
- **`/new [name]`**: Creates a new channel and starts an OpenCode session in a dedicated sandbox.
- **`/attach`**: Attaches an OpenCode session to the current channel.
- **`/mode [plan|build]`**: Switch between Planning and Building modes.

### 🎮 Session Control

- **`/interrupt`**: Immediately kills the running `opencode` process in the current channel.
- **`/resume [session_id]`**: Attaches the current channel to an existing session ID.
- **`/restart`**: Stops the current process, wipes conversation history, and starts fresh.
- **`/peek-log`**: Displays the recent `stdout` and `stderr` for the current session.

### 🔍 Utility

- **`/ping`**: Verifies the bot is online.
- **`!plan [prompt]`**: Shortcut to switch to plan mode and run a prompt.
- **`!build [prompt]`**: Shortcut to switch to build mode and run a prompt.
