# Discord-OpenCode Bridge 🚀

The **Discord-OpenCode Bridge** allows you to control and monitor multiple `opencode` sessions on your computer directly from Discord.

### Why is this useful?

- **Remote Control:** Run `opencode` tasks from your phone, tablet, or another computer while you're away from your desk.
- **Session Persistence:** Start a task at home and check its progress or provide input from anywhere.
- **Multitasking:** Manage several independent agent sessions simultaneously, each in its own dedicated Discord channel.
- **No Setup Required on Mobile:** As long as the bridge is running on your Mac/PC, you can interact with it using the standard Discord app.

---

## ⚡ Quick Start

### 1. Prerequisites

- **OpenCode:** Ensure `opencode` is installed on your machine.
- **Make:** Most systems have this by default.

### 2. Discord Bot Setup

0.  **Create a Server:** We highly recommend creating a dedicated Discord server just for your OpenCode sessions. This keeps your workspace clean and ensures your private sessions aren't mixed with other conversations. You can always add collaborators later if needed.
1.  Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2.  Click **New Application** and give it a name.
3.  **Get Client ID:** In **General Information**, copy the **Application ID**.
4.  **Get Token:** In **Bot**, click **Reset Token** (or Copy) to get your bot token.
5.  **Enable Intent:** In **Bot**, scroll down and enable **Message Content Intent** (this is required for the bot to read your prompts).
6.  **Invite Bot:**
    - Go to **OAuth2 -> URL Generator**.
    - Select scopes: `bot` and `applications.commands`.
    - Select permissions: `Manage Channels`, `Send Messages`, `Read Message History`.
    - Copy the generated URL, paste it into your browser, and invite the bot to your server.
7.  **Get Guild ID:** In Discord, right-click your server name and select **Copy Server ID** (if you don't see this, enable "Developer Mode" in Discord Settings -> Advanced).

### 3. Environment Configuration

Create a `.env` file in the root of this project and fill in the details you gathered above:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
DISCORD_GUILD_ID=your_server_id_here
```

### 4. Run the Bridge

Simply run the following command in your terminal:

```bash
make run
```

_This command will automatically check for **Bun** (the runtime), install it if missing, set up dependencies, and start the bot._

---

## 🎮 How to Use

1.  **Initialize:** In your Discord server, use the `/setup` command and select a category. This is where the bot will create new channels for your sessions.
2.  **Start a Task:** Use `/new prompt: "Your request here"`. The bot will create a new channel and start the agent.
3.  **Interact:** Go to the newly created channel. Anything you type there will be sent as input to `opencode`.

## 📜 Commands

The bridge uses Discord Slash Commands for all interactions.

### 🛠️ Configuration & Setup

- **`/setup [category]`**: Sets the Discord category where the bot will create new session channels. **(Required first step)**
- **`/bind [folder]`**: Binds the current channel to a specific folder in the workspace (e.g., `folder: my-repo`). All subsequent agent tasks in this channel will run within that directory.
- **`/new [prompt]`**: Creates a new channel, assigns it a session name (e.g., `panda`), and starts the agent with your initial prompt.

### 🎮 Session Control

- **`/interrupt`**: Immediately kills the running `opencode` process in the current channel.
- **`/resume [session_id]`**: Attaches the current channel to an existing session (using its ID or animal alias).
- **`/restart`**: Stops the current process, wipes the conversation history, and starts a fresh session in the same channel.
- **`/peek-log`**: Displays the last 800 characters of `stdout` and `stderr` for the current session.

### 🔍 Utility & Debugging

- **`/debug`**: Shows the bot's status, including active sessions and permission checks.
- **`/reset`**: Force-clears the "busy" lock for a channel if an agent task is incorrectly marked as still running.
- **`/ping`**: Verifies the bot is online and responsive.
- **`/test-bridge [message]`**: Starts a mock session that echoes your input in uppercase to test the end-to-end communication without using an LLM.
