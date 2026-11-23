#!/bin/sh
# Venom hook wrapper for OpenHands (the OpenHands Software Agent SDK, which
# Agent Canvas, OpenHands Cloud and SDK scripts run). It runs the shared core
# for one event and prints the reply JSON OpenHands reads:
#   session-start, post-tool -> {"additionalContext":"..."}
#   stop                     -> {"decision":"deny","reason":"..."}
# Prints nothing when the core has nothing to say. Always exits 0.
#
#   venom-openhands.sh <event>   with the OpenHands hook JSON on stdin
#                                (event_type, session_id, tool_name, tool_input)
#
# OpenHands gives SessionStart context to the agent before the first prompt
# and sends a denied Stop's reason to the agent, which keeps working. It
# doesn't pass PostToolUse output to the model: there the core only notes the
# milestone, so the stop question can ask about it.

event=${1:-}
dir=$(dirname "$0")
input=$(cat 2>/dev/null) || input=""

text=$(printf '%s' "$input" | sh "$dir/venom-hook.sh" "$event" 2>/dev/null) || exit 0
[ -n "$text" ] || exit 0

case $event in
  stop) printf '{"decision":"deny","reason":"%s"}\n' "$text" ;;
  *) printf '{"additionalContext":"%s"}\n' "$text" ;;
esac
exit 0
