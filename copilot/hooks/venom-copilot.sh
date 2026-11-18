#!/bin/sh
# Venom hook wrapper for GitHub Copilot CLI and VS Code agent mode (the shared
# Copilot harness). It runs the shared core for one event and prints the reply
# JSON Copilot reads:
#   session-start, subagent, post-tool -> {"additionalContext":"..."}
#   stop                               -> {"decision":"block","reason":"..."}
# Prints nothing when the core has nothing to say. Always exits 0.
#
#   venom-copilot.sh <event>   with the Copilot hook JSON (PascalCase events,
#                              snake_case fields) on stdin
#
# Copilot also fires PostToolUse and Stop inside subagents, with agent_id and
# parent_agent_id in the payload. Subagents report to their parent instead of
# writing to Venom, so those calls say nothing.

event=${1:-}
dir=$(dirname "$0")
input=$(cat 2>/dev/null) || input=""

case $event in
  post-tool | stop)
    case $input in *',"agent_id":"'*) exit 0 ;; esac
    ;;
esac

text=$(printf '%s' "$input" | sh "$dir/venom-hook.sh" "$event" 2>/dev/null) || exit 0
[ -n "$text" ] || exit 0

case $event in
  stop) printf '{"decision":"block","reason":"%s"}\n' "$text" ;;
  *) printf '{"additionalContext":"%s"}\n' "$text" ;;
esac
exit 0
