#!/bin/sh
# Gemini CLI wrapper for the shared Venom hook core (venom-hook.sh).
#
#   gemini-hook.sh <session-start|post-tool|stop>   with Gemini's hook JSON on stdin
#
# Runs the core and wraps its one-line text in Gemini's reply format:
#   session-start, post-tool -> {"hookSpecificOutput":{"hookEventName":...,"additionalContext":...}}
#   stop (AfterAgent)        -> {"decision":"deny","reason":...} (Gemini sends the reason to the agent as a new prompt)
# Prints nothing and exits 0 when the core has nothing to say. Never fails Gemini.

event=${1:-}
input=$(cat 2>/dev/null) || input=""
here=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || exit 0
core="$here/venom-hook.sh"
[ -f "$core" ] || exit 0

pick() {
  printf '%s' "$input" | tr '\n' ' ' |
    grep -o -E "\"$1\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n 1 |
    sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

# Gemini also passes the session id in the environment.
[ -n "${VENOM_HOOK_SESSION:-}" ] || VENOM_HOOK_SESSION=${GEMINI_SESSION_ID:-}
[ -n "$VENOM_HOOK_SESSION" ] && export VENOM_HOOK_SESSION || unset VENOM_HOOK_SESSION

case $event in
  session-start) core_event=session-start; name=SessionStart ;;
  post-tool)
    core_event=post-tool; name=AfterTool
    # Only the tool's name decides whether a Venom log call happened, not text inside its output.
    tool=$(pick tool_name)
    [ -n "$tool" ] && export VENOM_HOOK_TOOL="$tool"
    ;;
  stop) core_event=stop; name=AfterAgent ;;
  *) exit 0 ;;
esac

text=$(printf '%s' "$input" | sh "$core" "$core_event" 2>/dev/null)
[ -n "$text" ] || exit 0

if [ "$event" = stop ]; then
  printf '{"decision":"deny","reason":"%s"}\n' "$text"
else
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$name" "$text"
fi
exit 0
