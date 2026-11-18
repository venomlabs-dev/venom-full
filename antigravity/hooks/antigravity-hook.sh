#!/bin/sh
# Antigravity wrapper around the shared Venom hook (venom-hook.sh, same folder).
# Antigravity hooks read JSON on stdin and answer with JSON on stdout.
#
#   session-start    -> {"injectSteps":[{"systemMessage":{"systemMessage":"..."}}]}
#   post-tool        -> remembers a milestone reminder (PostToolUse cannot add text)
#   pre-invocation   -> {"injectSteps":[{"ephemeralMessage":"..."}]} with it, before the next model call
#   stop             -> {"decision":"continue","reason":"..."}
#
# Prints nothing when there is nothing to say. Always exits 0.

event=${1:-}
input=$(cat 2>/dev/null) || input=""
core="$(dirname "$0")/venom-hook.sh"

# The value of the first "key": "value" pair among the given keys, one line.
json_value() {
  printf '%s' "$input" | tr '\n' ' ' |
    grep -o -E "\"($1)\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n 1 |
    sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

session=${ANTIGRAVITY_CONVERSATION_ID:-$(json_value conversationId)}
session=$(printf '%s' "${session:-ppid-$PPID}" | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
dir="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"
outbox="$dir/$session.outbox"
# The outbox needs a folder only this user owns (not a link, as the core requires).
state_ok() {
  (umask 077 && mkdir -p "$dir") 2>/dev/null
  [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ]
}

core_run() { printf '%s' "$2" | VENOM_HOOK_SESSION="$session" VENOM_HOOK_COMMAND="${3:-}" VENOM_HOOK_TOOL="${4:-}" sh "$core" "$1" 2>/dev/null; }

case $event in
  session-start)
    text=$(core_run session-start '{}')
    [ -n "$text" ] && printf '{"injectSteps":[{"systemMessage":{"systemMessage":"%s"}}]}\n' "$text"
    ;;
  post-tool)
    # The tool name sits next to its id inside toolCall.
    name=$(printf '%s' "$input" | tr '\n' ' ' | grep -o -E '"id"[[:space:]]*:[[:space:]]*"[^"]*"[[:space:]]*,[[:space:]]*"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"//; s/"$//')
    [ -n "$name" ] || name=$(json_value name)
    command=""
    case $name in
      run_command) command=$(json_value CommandLine) ;;
      *append_task_log* | *append_project_log* | *edit_log_entry*) ;;
      *) exit 0 ;;
    esac
    # A tool error means the command did not run: no milestone.
    [ -n "$command" ] && [ -n "$(json_value error)" ] && exit 0
    text=$(core_run post-tool '{}' "$command" "$name")
    if [ -n "$text" ]; then
      state_ok && printf '%s\n' "$text" > "$outbox"
    elif [ -z "$command" ]; then
      rm -f "$outbox"
    fi
    ;;
  pre-invocation)
    state_ok || exit 0
    [ -f "$outbox" ] || exit 0
    text=$(cat "$outbox" 2>/dev/null)
    rm -f "$outbox"
    [ -n "$text" ] && printf '{"injectSteps":[{"ephemeralMessage":"%s"}]}\n' "$text"
    ;;
  stop)
    case $input in *'"continuationActive":true'* | *'"continuationActive": true'* | *'"fullyIdle":false'* | *'"fullyIdle": false'*) exit 0 ;; esac
    text=$(core_run stop "$input")
    [ -n "$text" ] && printf '{"decision":"continue","reason":"%s"}\n' "$text"
    ;;
esac
exit 0
