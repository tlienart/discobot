# Architectural Decision: Stable Persistence via Session Management

After experimenting with both **One-Shot** (Process-per-Turn) and **Persistent** (Stdin-Piping) models, we have decided to standardize on the **Process-per-Turn** model.

## 1. The Winning Model: "Stable Persistence"

**Mechanism**:

- For every user message, the bridge spawns a fresh `opencode` process.
- The `--session <NAME>` flag is passed to every process.
- **OpenCode** handles the state by loading history from its own database.

### Why this won:

- **Buffering & TTY Issues**: Persistent mode (piping to `stdin`) suffered from output buffering issues on the OS level, causing the bridge to "miss" events until the process exited.
- **Reliability**: If the bridge or a process crashes, no state is lost. The next message simply starts a new process and picks up the context.
- **Simplicity**: We avoided complex PTY handling and "re-attach" logic.
- **Experience**: The 1-2s startup delay is negligible compared to LLM reasoning time, and the "feel" is identical to a continuous conversation.

## 2. Human-Readable Session Names

To make the bridge more user-friendly, we replaced long hexadecimal IDs with **Animal-based Names**.

- **Format**: `ses_<animal>` (e.g., `ses_panda`).
- **UI Display**: The bot displays only the animal part to the user: `🆔 **Session Name:** panda`.
- **Usage**: Users can resume sessions using these names: `/resume session_id: panda`.

## 3. UX Observations Log

| Date       | Observation                                                                                | Result        |
| :--------- | :----------------------------------------------------------------------------------------- | :------------ |
| 2026-01-19 | Persistent mode (piping) failed to stream output due to buffering.                         | **ABANDONED** |
| 2026-01-19 | One-Shot with `--session` successfully preserved context (e.g., remembering "Bangladesh"). | **ADOPTED**   |
| 2026-01-19 | Animal names are significantly easier to remember and type than hex IDs.                   | **ADOPTED**   |
