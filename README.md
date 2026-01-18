# Discord-OpenCode Bridge

A portable bridge that allows you to interact with long-running `opencode` sessions directly from Discord.

## Features
- **Long-Running Sessions**: Persists context across multiple interactions.
- **Headless Management**: Start (`/new`) and resume (`/resume`) sessions from Discord.
- **Smart Filtering**: Filters out agent internal logs, showing only actionable output.
- **Visual Feedback**: Real-time "Typing" indicators when the agent is working.
- **Remote Control**: Send interrupt signals (`/interrupt`) to stop runaway processes.

## Prerequisites
1. **Bun**: [Install Bun](https://bun.sh/)
2. **OpenCode**: Ensure `opencode` is installed and available in your PATH.

## Setup Instructions

### 1. Discord Bot Configuration
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a **New Application**.
3. Under the **Bot** tab:
   - Reset/Copy your **Token**.
   - **CRITICAL**: Scroll down to **Privileged Gateway Intents** and enable **Message Content Intent**.
4. Under **OAuth2 -> URL Generator**:
   - Select `bot` and `applications.commands` scopes.
   - Select permissions: `Manage Channels`, `Send Messages`, `Read Message History`.
   - Use the generated URL to invite the bot to your server.

### 2. Environment Setup
Create a `.env` file in the project root:
```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
```

### 3. Installation
```bash
bun install
```

## Usage
1. **Start the Bridge**:
   ```bash
   bun index.ts
   ```
2. **Configure Category**: In Discord, use `/setup` and select a category where the bot will create session channels.
3. **Start a Session**: Use `/new prompt: "Help me build a web app"`.
4. **Interact**: Once a channel is created, simply type messages in that channel to talk to the agent.
5. **Resume**: Use `/resume session_id: "..."` to pick up an old conversation.
6. **Interrupt**: Use `/interrupt` in a session channel to send a double-ESC signal.
