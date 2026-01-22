# Discord-OpenCode Bridge 🚀

The **Discord-OpenCode Bridge** allows you to control and monitor multiple `opencode` sessions on your computer directly from Discord.

### Why is this useful?

- **Remote Control:** Run `opencode` tasks from your phone, tablet, or another computer while you're away from your desk.
- **Session Persistence:** Start a task at home and check its progress or provide input from anywhere.
- **Multitasking:** Manage several independent agent sessions simultaneously, each in its own dedicated Discord channel.
- **Sandboxed Security:** Runs in an isolated environment where secrets are hidden and host files are protected.

---

## ⚡ Quick Start

### 1. Prerequisites

- **OpenCode:** Ensure `opencode` is installed on your machine.
- **Alcless:** Required for sandboxing on macOS.
- **Make:** Most systems have this by default.

### 2. Sandbox Setup (macOS only)

We use [alcless](https://github.com/AkihiroSuda/alcless) for secure, lightweight isolation. It was created by [Akihiro Suda](https://github.com/AkihiroSuda), the lead developer of [Lima](https://github.com/lima-vm/lima) (the engine behind Docker Desktop alternative on Mac) and a prominent figure in the macOS container ecosystem.

1.  **Install `alcless`**:
    Follow the installation guide on the [alcless repository](https://github.com/AkihiroSuda/alcless) to get the `alclessctl` tool.

2.  **Initialize the Sandbox**:
    Run the following command:

    ```bash
    alclessctl create default
    ```

    - **First Prompt**: Enter **your own macOS user password** (to allow `alcless` to set up the new user).
    - **Second Prompt**: When asked for the `alcless` user password, **leave it blank and press Enter**.

3.  **Install Dependencies in the Sandbox**:
    Open a shell inside the sandbox:
    ```bash
    alclessctl shell --plain default bash
    ```
    Inside that shell, install the necessary CLI tools using `brew`:
    ```bash
    brew install gh opencode
    ```

### 3. Configuration

Create a `config.json` file in the root of this project:

```json
{
  "discord": {
    "token": "your_bot_token",
    "clientId": "your_client_id",
    "guildId": "your_guild_id",
    "sessionDb": "sessions.json"
  },
  "sandbox": {
    "enabled": true,
    "workspaceDir": "/Users/Shared/discobot-workspace",
    "sandboxGhToken": "your_dedicated_sandbox_pat",
    "opencodeConfigPath": "/Users/yourname/.config/opencode/opencode.json"
  },

  "apiKeys": {
    "google": "your_gemini_key",
    "openai": "your_openai_key"
  }
}
```

### 4. Run the Bridge

```bash
make run
```

---

## 📜 Commands

The bridge uses Discord Slash Commands for all interactions.

### 🛠️ Configuration & Setup

- **`/setup [category]`**: Sets the Discord category where the bot will create new session channels.
- **`/new [name]`**: Creates a new channel with the given name and starts an OpenCode session bound to a folder of the same name.
- **`/attach`**: Attaches an OpenCode session to the current channel, using the channel name as the workspace alias.
- **`/bind [folder]`**: Manually binds the current channel to a specific folder in the workspace.

### 🎮 Session Control

- **`/interrupt`**: Immediately kills the running `opencode` process in the current channel.
- **`/resume [session_id]`**: Attaches the current channel to an existing session ID.
- **`/restart`**: Stops the current process, wipes conversation history, and starts fresh.
- **`/peek-log`**: Displays the recent `stdout` and `stderr` for the current session.

### 🔍 Utility & Debugging

- **`/debug`**: Shows the bot's status and active sessions.
- **`/reset`**: Force-clears the "busy" lock for a channel.
- **`/ping`**: Verifies the bot is online.
- **`/test-bridge [message]`**: Starts a mock session to test communication.
