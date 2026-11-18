#!/bin/sh
# Qwen Code wrapper for the shared Venom hook script.
#
#   venom-qwen.sh <core-event> <context|block> <HookEventName>   hook JSON on stdin
#
# Runs venom-hook.sh next to it and puts its one-line text in Qwen Code's reply
# JSON: hookSpecificOutput.additionalContext for "context", or a Stop block
# whose reason is the text for "block" (Qwen Code then lets the agent answer
# once more). Prints nothing when the core has nothing to say. Never fails.

here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0
event=${1:-}
kind=${2:-context}
name=${3:-}
input=$(cat 2>/dev/null) || input=""

# Qwen Code names the tool in "tool_name" (run_shell_command, or an MCP tool
# such as mcp__venom__append_task_log). Pass it so a shell command that only
# mentions a log tool is not read as a Venom log call.
tool=$(printf '%s' "$input" | tr '\n' ' ' |
  grep -o -E '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 |
  sed -E 's/^"tool_name"[[:space:]]*:[[:space:]]*"//; s/"$//')
[ -n "$tool" ] && export VENOM_HOOK_TOOL="$tool"

text=$(printf '%s' "$input" | sh "$here/venom-hook.sh" "$event" 2>/dev/null) || text=""
[ -n "$text" ] || exit 0

if [ "$kind" = block ]; then
  printf '{"decision":"block","reason":"%s"}\n' "$text"
else
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$name" "$text"
fi
exit 0
