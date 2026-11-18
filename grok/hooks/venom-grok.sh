#!/bin/sh
# Grok Build wrapper for the shared Venom hook core (venom-hook.sh).
#
#   venom-grok.sh tool      PostToolUse: first call of a session or subagent gets the
#                           session-start or subagent text; first call after a
#                           compaction gets the compacted text; shell commands and
#                           Venom log calls go through the core (milestones)
#   venom-grok.sh compact   PostCompact: remembers that the next tool call says so
#   venom-grok.sh stop      Stop: asks once to log after merge/release/deploy/publish
#
# Grok shows a SessionStart, SubagentStart or PostCompact message to the user
# only, so those texts ride on the next PostToolUse note instead. It prints
# nothing when there is nothing to say and always exits 0.
mode=${1:-}
input=$(cat 2>/dev/null) || input=""
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0

session=$(printf '%s' "$input" | tr '\n' ' ' |
  grep -o -E '"(sessionId|session_id)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 |
  sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//')
session=$(printf '%s' "${session:-ppid-$PPID}" | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
export VENOM_HOOK_SESSION=$session
dir="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"
mkdir -p "$dir" 2>/dev/null || exit 0

core() { printf '%s' "$input" | sh "$here/venom-hook.sh" "$1" 2>/dev/null; }

case $mode in
  compact)
    : > "$dir/$session.compacted"
    exit 0
    ;;
  stop)
    # Stop also fires when the session ends: nothing can continue then.
    case $input in
      *'"reason":"channel_closed"'* | *'"reason": "channel_closed"'* | *'"reason":"shutdown"'* | *'"reason": "shutdown"'*) exit 0 ;;
    esac
    text=$(core stop) || exit 0
    [ -n "$text" ] || exit 0
    printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}\n' "$text"
    exit 0
    ;;
  tool) ;;
  *) exit 0 ;;
esac

text=""
add() { [ -n "$1" ] && text="${text:+$text }$1"; }

if [ ! -f "$dir/$session.started" ]; then
  : > "$dir/$session.started"
  case $input in
    *'"subagentType"'*) add "$(core subagent)" ;;
    *) add "$(core session-start)" ;;
  esac
fi
if [ -f "$dir/$session.compacted" ]; then
  rm -f "$dir/$session.compacted"
  add "$(core compacted)"
fi
add "$(core post-tool)"

[ -n "$text" ] || exit 0
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$text"
exit 0
