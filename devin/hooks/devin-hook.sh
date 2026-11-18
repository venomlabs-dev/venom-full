#!/bin/sh
# Devin CLI wrapper for the shared Venom hook core (venom-hook.sh).
#
#   devin-hook.sh session-start|post-tool|stop   with Devin's hook JSON on stdin
#
# Runs the core and prints Devin's reply JSON: additionalContext for
# SessionStart and PostToolUse, a block decision for Stop. Prints nothing when
# the core prints nothing. Always exits 0.

event=${1:-}
input=$(cat 2>/dev/null) || input=""
here=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || exit 0
core="$here/venom-hook.sh"
[ -f "$core" ] || exit 0

case $event in
  session-start) name=SessionStart ;;
  post-tool) name=PostToolUse ;;
  stop) name=Stop ;;
  *) exit 0 ;;
esac

# Devin puts the tool in "tool_name" and the shell command in
# tool_input.command; the core finds the command and session_id itself, but
# the tool name must not be guessed from the whole payload (a command that
# merely mentions a Venom log tool is not a log call).
tool=$(printf '%s' "$input" | tr '\n' ' ' |
  grep -o -E '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 |
  sed -E 's/^"tool_name"[[:space:]]*:[[:space:]]*"//; s/"$//')
case $event in
  post-tool) VENOM_HOOK_TOOL=${tool:-unknown}; export VENOM_HOOK_TOOL ;;
esac

text=$(printf '%s' "$input" | sh "$core" "$event" 2>/dev/null) || exit 0
[ -n "$text" ] || exit 0

if [ "$event" = stop ]; then
  printf '{"decision":"block","reason":"%s"}\n' "$text"
else
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$name" "$text"
fi
exit 0
