#!/bin/sh
# Factory Droid hook wrapper: runs the shared Venom core and puts its text in
# hookSpecificOutput.additionalContext.
#
#   context.sh SessionStart   (startup, resume, clear and compact)
#   context.sh PostToolUse    (Execute calls and Venom log tools)
#
# Prints nothing and exits 0 when the core has nothing to say.
here=$(dirname "$0")
name=${1:-}
input=$(cat 2>/dev/null) || input=""

pick() { printf '%s' "$input" | tr '\n' ' ' | grep -o -E "\"($1)\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'; }

case $name in
  SessionStart)
    if [ "$(pick source)" = compact ]; then event=compacted
    elif [ -n "$(pick calling_session_id)" ]; then event=subagent
    else event=session-start; fi ;;
  PostToolUse)
    event=post-tool
    # Only the tool name decides whether a Venom log call happened: a shell
    # command or its output that merely mentions a log tool must not count.
    VENOM_HOOK_TOOL=$(pick tool_name); export VENOM_HOOK_TOOL
    [ -n "$VENOM_HOOK_TOOL" ] || VENOM_HOOK_TOOL=unknown
    ;;
  *) exit 0 ;;
esac

text=$(printf '%s' "$input" | sh "$here/venom-hook.sh" "$event" 2>/dev/null)
[ -n "$text" ] || exit 0
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$name" "$text"
exit 0
