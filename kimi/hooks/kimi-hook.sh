#!/bin/sh
# Kimi Code CLI wrapper for the shared Venom hook core (venom-hook.sh).
#
#   kimi-hook.sh <UserPromptSubmit|PostToolUse|Stop|PostCompact>   hook JSON on stdin
#
# Kimi injects a hook's stdout into the model's context only for
# UserPromptSubmit. PostToolUse and PostCompact are fire-and-forget, so they
# queue their text and the next UserPromptSubmit delivers it. Stop is the one
# other event that reaches the model: exit 2 with a reason on stderr makes
# Kimi continue the turn with that reason as a user message.
# Always exits 0 (or 2 for the Stop reminder); never fails the agent.

event=${1:-}
input=$(cat 2>/dev/null) || input=""
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0
core="$here/venom-hook.sh"
[ -f "$core" ] || exit 0

json_value() {
  printf '%s' "$input" | tr '\n' ' ' |
    grep -o -E "\"($1)\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n 1 |
    sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

session=$(json_value 'session_id')
session=$(printf '%s' "${session:-ppid-$PPID}" | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
dir="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"
# Private state folder or nothing (a shared /tmp could hold someone else's folder or a link).
(umask 077 && mkdir -p "$dir") 2>/dev/null
{ [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ]; } || exit 0
queue="$dir/$session.kimi-queue"
started="$dir/$session.kimi-started"
export VENOM_HOOK_SESSION="$session"

# core_text <core event> [tool name for the core to use instead of scanning the payload]
core_text() { printf '%s' "$input" | VENOM_HOOK_TOOL="${2:-}" sh "$core" "$1" 2>/dev/null; }
enqueue() { [ -n "$1" ] && printf '%s\n' "$1" >> "$queue"; }

case $event in
  UserPromptSubmit)
    if [ ! -f "$started" ]; then
      touch "$started"
      core_text session-start
    fi
    if [ -s "$queue" ]; then
      cat "$queue"
      rm -f "$queue"
    fi
    ;;
  PostToolUse)
    tool=$(json_value 'tool_name')
    case $tool in
      *append_task_log* | *append_project_log* | *edit_log_entry*)
        # A Venom log call: the core drops its pending stop question; drop queued reminders too.
        core_text post-tool "$tool" >/dev/null
        rm -f "$queue"
        ;;
      Bash)
        enqueue "$(core_text post-tool Bash)"
        ;;
    esac
    ;;
  PostCompact)
    enqueue "$(core_text compacted)"
    ;;
  Stop)
    text=$(core_text stop)
    if [ -n "$text" ]; then
      rm -f "$queue"
      printf '%s\n' "$text" >&2
      exit 2
    fi
    ;;
esac
exit 0
