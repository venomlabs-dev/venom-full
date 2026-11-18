#!/bin/sh
# Venom hooks for JetBrains Junie. Runs the shared core (venom-hook.sh) and
# puts its one-line text into Junie's reply JSON.
#
#   junie-hook.sh prompt      UserPromptSubmit: session-start text, once per session
#   junie-hook.sh post-tool   PostToolUse: milestone reminder / Venom log call
#   junie-hook.sh stop        Stop: ask once to log after an outcome milestone
#
# Always exits 0 and prints nothing when the core prints nothing.

mode=${1:-}
dir=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || exit 0
core="$dir/venom-hook.sh"
[ -f "$core" ] || exit 0
input=$(cat 2>/dev/null) || input=""

base="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"

# Junie sends session_id only on SessionStart and UserPromptSubmit, not on
# PostToolUse or Stop. Key those by the Junie process: the hook runs under
# sh -c, so skip one shell level when the parent is a shell.
junie_pid=$PPID
comm=$(ps -o comm= -p "$junie_pid" 2>/dev/null)
case ${comm##*/} in
  sh | bash | dash | zsh | -sh | -bash)
    up=$(ps -o ppid= -p "$junie_pid" 2>/dev/null | tr -cd '0-9')
    [ -n "$up" ] && junie_pid=$up
    ;;
esac
export VENOM_HOOK_SESSION="junie-$junie_pid"

emit() { # $1 = hookEventName, $2 = text
  [ -n "$2" ] && printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$1" "$2"
  exit 0
}

case $mode in
  prompt)
    id=$(printf '%s' "$input" | tr '\n' ' ' |
      grep -o -E '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 |
      sed -E 's/.*:[[:space:]]*"//; s/"$//' | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
    [ -n "$id" ] || id="junie-$junie_pid"
    mkdir -p "$base" 2>/dev/null || exit 0
    marker="$base/junie-started.$id"
    [ -f "$marker" ] && exit 0
    : > "$marker"
    find "$base" -type f -mtime +1 -exec rm -f {} + 2>/dev/null
    emit UserPromptSubmit "$(printf '%s' "$input" | sh "$core" session-start)"
    ;;
  post-tool)
    emit PostToolUse "$(printf '%s' "$input" | sh "$core" post-tool)"
    ;;
  stop)
    emit Stop "$(printf '%s' "$input" | sh "$core" stop)"
    ;;
esac
exit 0
