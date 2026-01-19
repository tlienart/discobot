# Project Plan: Discord-OpenCode Bridge

This project aims to build a portable bridge between Discord and multiple `opencode` sessions running on a Mac server.

## Goals

- **Remote Monitoring**: View summaries and prompts from `opencode` sessions in Discord.
- **Remote Interaction**: Send messages from Discord to be injected as input into `opencode`.
- **Long-Running Sessions**: Maintain a persistent stateful connection to `opencode` processes to preserve context across multiple turns.
- **Session Lifecycle Management**: Start new sessions or resume existing ones (via session IDs) directly from Discord.
- **Noise Reduction**: Use structured JSON events to filter out "Chain of Thought" (CoT) and only show actionable output.
- **Status Visibility**: Visual indicators (typing status or heartbeat) to show when `opencode` is "busy" thinking.
- **Interrupt Capability**: Ability to send interrupt signals (simulated double-ESC) to stop a runaway or stuck session.

## Architecture

### 1. Bridge Service (Bun/TypeScript)

- **Discord Client**: Handles slash commands (`/new`, `/resume`, `/interrupt`) and message events.
- **Process Manager**: Spawns and tracks `opencode` child processes using `Bun.spawn`.
- **Event Parser**: Consumes `opencode --format json` stream to:
  - Detect when input is required (prompt user in Discord).
  - Detect when the agent is busy (trigger Discord typing indicator).
  - Extract final summaries for display.
- **Input Streamer**: Forwards Discord text to `stdin`.

### 2. State Management

- A local mapping (file or memory) between Discord Channel IDs and `opencode` Session IDs.

## Roadmap

- [x] **Phase 1: Environment & Tooling Setup**
  - Project initialization with ESLint, Prettier, and Vitest.
  - Verification of `opencode` JSON event structure.
- [x] **Phase 2: Discord Bot Foundation & Documentation**
  - Register Discord App and Bot.
  - Document setup process (ID, Token, Permissions).
  - Implement basic command infrastructure.
- [x] **Phase 3: Session Management (The "Core")**
  - Implement `/new` and `/resume` logic (Partial: `/resume` handler missing).
  - Implement process spawning and JSON stream parsing.
  - Implement "Busy" status (Typing indicator/Heartbeat).
- [x] **Phase 4: Bidirectional Flow & Control**
  - Input injection from Discord messages.
  - Interrupt signal implementation (`/interrupt`).
  - Feedback loop (reactions) for input confirmation.
- [x] **Phase 5: Reliability & Testing**
  - [x] Integration tests for the full flow.
  - [x] Error recovery (re-attaching to sessions after bridge restart).

- [x] **Phase 6: Maintenance & Bug Fixes**
  - [x] Fix One-Shot regression caused by session ID pre-generation.
  - [x] Fix JSON parser hang on tool outputs with braces.
- [x] **Phase 9: Response Optimization & Interactivity**
  - [x] Implement Direct Stream architecture (Pipe-based).
  - [x] Implement silent summarization loop for messages > 2000 chars.
  - [x] Enhance terminal logging for tool usage and context processing.
  - [x] Single updating 'Still thinking' message with elapsed time.
  - [x] Remove "Using tool..." UI noise (and fix regression in #9).

- [x] **Phase 7: Session Lifecycle & Interaction**
  - [x] Implement `/restart` commands (TASKS_026).
  - [x] Implement `/resume` handler (TASKS_028).
  - [x] Remove redundant `/terminate` command.
  - [x] Standardize on "Stable Persistence" (One-Shot with Session IDs).

- [ ] **Phase 10: Server-Side Security & Sandboxing**
  - [x] Architect plan for agent isolation (SANDBOX_PLAN.md).
  - [ ] Implement Fence-based sandbox wrapper (TASKS_030).
  - [ ] Implement state relocation (XDG path overrides).
  - [ ] Implement automated session pruning (GC Sweep).
  - [ ] Implement Git branch protection patterns.

## Setup Requirements (Preview)

- **Discord Permissions**: `Manage Channels`, `Send Messages`, `Read Message History`, `Use Slash Commands`.
- **Environment Variables**: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`.
