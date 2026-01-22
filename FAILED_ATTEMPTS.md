# Failed Sandbox Implementation Attempts

This document tracks approaches that were tried and failed, to avoid circular debugging.

## 1. Environment Variable Secret Injection

- **Attempt**: Passing `GOOGLE_API_KEY` directly via `alclessctl shell -c "export ..."`
- **Failure**: Secrets are visible to the agent via `env` or `cat /proc/self/environ`. adversarial agents could leak them.
- **Status**: Abandoned in favor of Host-Side Bridge Proxy.

## 2. Shared Workspace in Home Directory

- **Attempt**: Using `./workspace` in the project root.
- **Failure**: macOS prevents the `alcless` sandbox user from accessing the host user's home directory even with `chmod 777`.
- **Status**: Moved to `/Users/Shared/discobot-workspace`.

## 3. TCP Loopback Proxy (127.0.0.1)

- **Attempt**: Running a Bun server on a TCP port and connecting from the sandbox.
- **Failure**: macOS user isolation often blocks cross-user TCP traffic on the loopback interface, resulting in "Connection Refused".
- **Status**: Switched to Unix Domain Sockets in `/Users/Shared`.

## 4. HTTP-to-Unix Bridge (Python Sidecar)

- **Attempt 1**: Simple Python bridge with high-level HTTP libraries.
- **Failure**: Caused deadlocks and failed to stream Server-Sent Events (SSE) correctly, making the agent hang during long generations.
- **Status**: Refined to use low-level raw socket bidirectional piping.

## 5. Random Port Selection

- **Attempt**: Using `$RANDOM` in `entrypoint.sh` for each turn.
- **Failure**: Caused "Address already in use" errors because ports stayed in `TIME_WAIT`.
- **Status**: Switched to a "Retry-on-Bind" loop in Python.

## 6. Temporary Workspace Folders (`temp_...`)

- **Attempt**: Creating a new folder for the first turn before the `sessionID` is known.
- **Failure**: On the second turn, the bot would try to "resume" using the `sessionID` as the folder name. Since the history was in the `temp_...` folder, the second turn started with an empty history, causing context loss and `NotFoundError`.
- **Status**: Abandoned. We must use stable aliases or rename folders upon discovery.

## 8. Temporary Folder Context Disconnect

- **Attempt**: Creating `temp_...` folders for new sessions.
- **Failure**: On the second turn, the bot resumes with the `sessionID`. If the first turn was in a `temp_` folder, Turn 2 starts in a new folder, losing all history and causing `NotFoundError` for SQLite state.
- **Status**: Abandoned. Moving to stable channel-name-based folders.

## 9. Localhost TCP Reachability

- **Attempt**: Pointing `BASE_URL` variables to `127.0.0.1`.
- **Failure**: macOS user isolation often blocks loopback TCP traffic between different users, resulting in "Connection Refused".
- **Status**: Solved using a shared Unix Socket bridge in `/Users/Shared`.

## 10. HTTP Header Conflicts in Proxy

- **Attempt**: Forwarding headers like `Transfer-Encoding` or `Host` verbatim.
- **Failure**: Caused `400 Bad Request` or `chunked-encoding` errors from LLM providers.
- **Status**: Solved by explicitly filtering sensitive headers and re-constructing the request on the host.
