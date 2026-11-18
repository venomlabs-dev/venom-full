#!/bin/sh
# Mistral Vibe wrapper: runs the shared Venom core and returns its text as
# hook_specific_output.additional_context.
#
#   vibe-context.sh <session-start|subagent|post-tool>   (Vibe's hook JSON on stdin)
#
# Prints nothing and exits 0 when the core has nothing to say.

event=${1:-}
input=$(cat 2>/dev/null) || input=""
here=$(dirname "$0")

# A failed shell command is not a milestone.
case $input in *'"tool_status": "failure"'* | *'"tool_status":"failure"'*) exit 0 ;; esac

# Only a subagent session has a parent session; the user's own session has null.
if [ "$event" = subagent ]; then
  case $input in *'"parent_session_id": null'* | *'"parent_session_id":null'*) exit 0 ;; esac
  case $input in *'"parent_session_id"'*) ;; *) exit 0 ;; esac
  # Once per subagent session: the note stays in its context for later turns.
  sid=$(printf '%s' "$input" | tr '\n' ' ' |
    grep -o -E '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 |
    sed -E 's/^"session_id"[[:space:]]*:[[:space:]]*"//; s/"$//' | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
  if [ -n "$sid" ]; then
    mark="${PLUGIN_DATA:-${TMPDIR:-/tmp}}/venom-subagent-$sid"
    [ -f "$mark" ] && exit 0
    mkdir -p "$(dirname "$mark")" 2>/dev/null && : > "$mark" 2>/dev/null
  fi
fi

# The top-level tool_name (it comes before tool_input and tool_output), so a
# command or output that merely mentions a Venom tool can't clear the stop.
if [ "$event" = post-tool ]; then
  tool=$(printf '%s' "$input" | tr '\n' ' ' |
    grep -o -E '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 |
    sed -E 's/^"tool_name"[[:space:]]*:[[:space:]]*"//; s/"$//')
  [ -n "$tool" ] && export VENOM_HOOK_TOOL="$tool"
fi

text=$(printf '%s' "$input" | sh "$here/venom-hook.sh" "$event" 2>/dev/null) || exit 0
[ -n "$text" ] || exit 0
printf '{"hook_specific_output": {"additional_context": "%s"}}\n' "$text"
exit 0
