#!/bin/sh
# Adapter between Cline's file hooks and the shared Venom core (venom-hook.sh,
# next to this file). Cline runs a hook file named after the event, passes the
# event JSON on stdin and reads one JSON object from stdout; contextModification
# is added to what the model sees on its next request.
#
#   venom-cline.sh task-start | post-tool      (called by the TaskStart and
#                                               PostToolUse hook files)
#
# Always exits 0 and always prints one JSON object. {"cancel":false} means
# "nothing to add" (Cline's VS Code extension expects the cancel field).

event=${1:-}
input=$(cat 2>/dev/null) || input=""
here=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || here=.
core="$here/venom-hook.sh"
flat=$(printf '%s' "$input" | tr '\n\r' '  ')

reply() {
  if [ -n "$1" ]; then
    printf '{"cancel":false,"contextModification":"%s"}\n' "$1"
  else
    printf '{"cancel":false}\n'
  fi
  exit 0
}

[ -f "$core" ] || reply ""

# Cline names the conversation taskId in every payload.
session=$(printf '%s' "$flat" | grep -o -E '"taskId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 |
  sed -E 's/^"taskId"[[:space:]]*:[[:space:]]*"//; s/"$//')
export VENOM_HOOK_SESSION="$session"
sid=$(printf '%s' "${session:-ppid-$PPID}" | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
# State lives in a folder only this user owns (same guard as the shared core);
# if it can't be trusted, skip the once-per-task memory but still answer.
dir="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"
(umask 077 && mkdir -p "$dir") 2>/dev/null
state=1
{ [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ]; } || state=0

case $event in
  task-start)
    # The VS Code extension runs TaskStart before every turn, not once per
    # task, so say it once per task.
    if [ "$state" = 1 ]; then
      [ -f "$dir/$sid.cline-started" ] && reply ""
      touch "$dir/$sid.cline-started"
    else
      reply ""
    fi
    # A hook run for a subagent carries its parent's id.
    if printf '%s' "$flat" | grep -q -E '"parent_agent_id"[[:space:]]*:[[:space:]]*"[^"]+"'; then
      reply "$(printf '%s' "$input" | sh "$core" subagent)"
    fi
    reply "$(printf '%s' "$input" | sh "$core" session-start)"
    ;;
  post-tool)
    # run_commands takes {"commands": ["git commit -m x", ...]}. The CLI
    # payload carries it as an array (tool_result.input), the VS Code one as a
    # JSON string of that array (postToolUse.parameters.commands). Rebuild one
    # command line with ; between commands for the core.
    rest=$(printf '%s' "$flat" | grep -o -E '"commands"[[:space:]]*:[[:space:]]*.*' | head -n 1 |
      sed -E 's/^"commands"[[:space:]]*:[[:space:]]*//')
    cmd=""
    case $rest in
      '['*)
        cmd=$(printf '%s' "$rest" | sed -E 's/^\[[[:space:]]*"//; s/([^\\])"[[:space:]]*\].*$/\1/; s/([^\\])"[[:space:]]*,[[:space:]]*"/\1 ; /g') ;;
      '"['*)
        cmd=$(printf '%s' "$rest" | sed -E 's/^"\[[[:space:]]*\\"//; s/\\"[[:space:]]*\]".*$//; s/\\"[[:space:]]*,[[:space:]]*\\"/ ; /g') ;;
    esac
    case $cmd in '{'* | '"'*) cmd="" ;; esac
    [ -n "$cmd" ] && export VENOM_HOOK_COMMAND="$cmd"
    reply "$(printf '%s' "$input" | sh "$core" post-tool)"
    ;;
esac
reply ""
