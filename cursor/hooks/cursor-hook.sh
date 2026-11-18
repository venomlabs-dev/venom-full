#!/bin/sh
# Cursor wrapper for the shared Venom hook core (venom-hook.sh).
#
#   cursor-hook.sh session-start   sessionStart       -> {"additional_context": "..."}
#   cursor-hook.sh post-tool       postToolUse        -> {"additional_context": "..."}
#   cursor-hook.sh subagent        subagentStart      -> {"additional_context": "..."}
#   cursor-hook.sh stop            stop               -> {"followup_message": "..."}
#
# Cursor sends the hook JSON on stdin. This script finds the conversation id,
# the tool name and the shell command in it, runs the core and wraps the core's
# one-line text in Cursor's reply JSON. It prints nothing when the core does,
# and it always exits 0.

event=${1:-}
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0
core="$here/venom-hook.sh"
[ -f "$core" ] || exit 0
input=$(cat 2>/dev/null) || input=""
flat=$(printf '%s' "$input" | tr '\n' ' ')

# The first "key": "value" among the given keys in the text on stdin.
value() {
  printf '%s' "$2" | grep -o -E "\"($1)\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n 1 |
    sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

case $event in
  session-start) field=additional_context ;;
  post-tool) field=additional_context ;;
  subagent) field=additional_context ;;
  stop) field=followup_message ;;
  *) exit 0 ;;
esac

if [ "$event" = stop ]; then
  # Only a finished turn gets a follow-up.
  case $(value status "$flat") in aborted | error) exit 0 ;; esac
fi

VENOM_HOOK_SESSION=$(value conversation_id "$flat")
[ -n "$VENOM_HOOK_SESSION" ] || VENOM_HOOK_SESSION=$(value session_id "$flat")
export VENOM_HOOK_SESSION
if [ "$event" = post-tool ]; then
  VENOM_HOOK_TOOL=$(value tool_name "$flat")
  # The command is inside tool_input; tool_output may carry other "command" keys.
  VENOM_HOOK_COMMAND=$(value 'command' "$(printf '%s' "$flat" | sed -E 's/^.*"tool_input"[[:space:]]*:[[:space:]]*//')")
  export VENOM_HOOK_TOOL VENOM_HOOK_COMMAND
fi

text=$(printf '%s' "$input" | sh "$core" "$event" 2>/dev/null) || exit 0
[ -n "$text" ] || exit 0
printf '{"%s":"%s"}\n' "$field" "$text"
exit 0
