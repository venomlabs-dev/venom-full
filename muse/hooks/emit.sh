#!/bin/sh
# Shared by the Venom hooks for Muse Code. Runs the Venom core for one event and
# prints Muse's hook reply JSON, or nothing.
#
#   emit.sh <core-event> <MuseEvent> <context|block>
#
# context: {"hookSpecificOutput":{"hookEventName":"<MuseEvent>","additionalContext":"..."}}
# block:   {"decision":"block","reason":"..."} (Stop: the agent goes on and answers it)
# The core's texts never hold double quotes, backslashes or line breaks, so they
# go into JSON as they are. Always exits 0.

core_event=${1:-}
muse_event=${2:-}
mode=${3:-context}
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0

input=$(cat 2>/dev/null) || input=""
text=$(printf '%s' "$input" | sh "$here/venom-hook.sh" "$core_event" 2>/dev/null) || text=""
[ -n "$text" ] || exit 0

if [ "$mode" = block ]; then
  printf '{"decision":"block","reason":"%s"}\n' "$text"
else
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$muse_event" "$text"
fi
exit 0
