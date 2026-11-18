#!/bin/sh
# Mistral Vibe wrapper for post_agent: when the core wants one more Venom
# question, ask the agent to revise its answer. Vibe sends the reason back as a
# new user message (at most 3 retries per turn). The core asks once, so the
# retry's own turn ends quietly.
#
# Prints nothing and exits 0 when the core has nothing to say.

here=$(dirname "$0")
text=$(sh "$here/venom-hook.sh" stop 2>/dev/null) || exit 0
[ -n "$text" ] || exit 0
printf '{"decision": "deny", "reason": "%s"}\n' "$text"
exit 0
