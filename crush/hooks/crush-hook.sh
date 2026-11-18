#!/bin/sh
# Venom hooks for Crush. Crush hooks print {"context": "..."} on stdout and
# only the tool events (PreToolUse, PostToolUse, PostToolUseFailure) can add
# context for the model, so:
#
#   crush-hook.sh pre-tool       PreToolUse, any tool: session start text on the
#                                first tool call of a session, and the
#                                compaction text on the first one after a
#                                compaction
#   crush-hook.sh post-tool      PostToolUse, bash and Venom log tools:
#                                milestone reminders; a log call clears the
#                                pending stop question (Crush has no event that
#                                can ask it, so it is never asked)
#   crush-hook.sh mark-compacted PostCompact (observe only): remembers that a
#                                compaction happened for the next pre-tool
#
# The wrapper runs venom-hook.sh (the shared core, same folder) and puts its
# one-line text into Crush's reply. It always exits 0 and prints nothing when
# there is nothing to say.

here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0
core="$here/venom-hook.sh"
[ -f "$core" ] || exit 0
mode=${1:-}
input=$(cat 2>/dev/null) || input=""
# Crush's JSON writes & < > as \u0026 \u003c \u003e: put them back, or the core
# would not see the && in "cd app && git commit".
input=$(printf '%s' "$input" | sed -e 's/\\u0026/\&/g' -e 's/\\u003c/</g' -e 's/\\u003e/>/g')

emit() {
  [ -n "$1" ] && printf '{"context":"%s"}\n' "$1"
  exit 0
}

json_value() {
  printf '%s' "$input" | tr '\n' ' ' |
    grep -o -E "\"($1)\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n 1 |
    sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

session=${CRUSH_SESSION_ID:-$(json_value session_id)}
tool=${CRUSH_TOOL_NAME:-$(json_value tool_name)}
project=${CRUSH_PROJECT_DIR:-${CRUSH_CWD:-$(json_value cwd)}}
safe() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._-' | cut -c1-80; }
session=$(safe "$session")
projkey=$(printf '%s' "$project" | cksum | cut -d' ' -f1)

# With no session id, the wrapper's own markers are keyed by the agent process:
# the first ancestor that isn't a shell. The core does the same by itself when
# it is given no session.
host_pid() {
  p=$PPID n=0
  while [ "$n" -lt 4 ] && [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    c=$(ps -o comm= -p "$p" 2>/dev/null | sed 's#.*/##; s/^-//')
    case $c in
      sh | bash | zsh | dash | ksh | env | timeout | "") p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); n=$((n + 1)) ;;
      *) break ;;
    esac
  done
  printf '%s' "${p:-$PPID}"
}
mark=${session:-host-$(host_pid)}

# State lives in a folder only this user owns (same guard as the shared core).
dir="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"
(umask 077 && mkdir -p "$dir") 2>/dev/null
{ [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ]; } || exit 0
started="$dir/crush-started.$mark"
compacted="$dir/crush-compacted.$projkey"

# No session id: pass none, so the core picks its own (the agent process).
run_core() { printf '%s' "$input" | VENOM_HOOK_SESSION="$session" VENOM_HOOK_TOOL="$tool" sh "$core" "$1" 2>/dev/null | head -n 1; }

case $mode in
  pre-tool)
    text=""
    if [ -f "$compacted" ]; then
      recent=$(find "$compacted" -mmin -240 2>/dev/null)
      rm -f "$compacted"
      if [ -n "$recent" ]; then
        text=$(run_core compacted)
        touch "$started" 2>/dev/null
      fi
    fi
    if [ ! -f "$started" ]; then
      touch "$started" 2>/dev/null
      find "$dir" -type f -name 'crush-*' -mtime +1 -exec rm -f {} + 2>/dev/null
      # A first call to a Venom tool means the agent already found Venom.
      case $tool in
        *venom*) ;;
        *) text="$text $(run_core session-start)" ;;
      esac
    fi
    emit "$(printf '%s' "$text" | sed -E 's/^ +//; s/ +$//')"
    ;;
  post-tool)
    emit "$(run_core post-tool)"
    ;;
  mark-compacted)
    touch "$compacted" 2>/dev/null
    exit 0
    ;;
esac
exit 0
