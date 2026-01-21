#!/bin/bash

# scripts/dumb-opencode.sh
# A simple mock for the OpenCode binary that just runs shell commands
# Expected args: run --format json [--session SID] "prompt"

# Shift away the fixed args: run --format json
shift 3

# Check if there is a --session flag
if [ "$1" == "--session" ]; then
    SESSION_ID=$2
    shift 2
fi

PROMPT="$1"

# Output the "thinking" start event
echo "{\"type\": \"step_start\"}"

# Execute the command and capture output
# We use eval or just sh -c to execute the prompt
echo "{\"type\": \"text\", \"text\": \"[Sandbox Shell] Executing: $PROMPT\"}"

RESULT=$(sh -c "$PROMPT" 2>&1)

# Escape backslashes and quotes for JSON
ESCAPED_RESULT=$(echo "$RESULT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

echo "{\"type\": \"text\", \"text\": $ESCAPED_RESULT}"

# Output the stop event
echo "{\"type\": \"step_finish\", \"part\": {\"reason\": \"stop\"}}"
