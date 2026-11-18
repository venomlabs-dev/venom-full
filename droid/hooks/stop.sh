#!/bin/sh
# Factory Droid Stop hook wrapper: runs the shared Venom core and, when it asks
# for a log, blocks the stop once so the text becomes Droid's next instruction.
# Droid ignores additionalContext on Stop; only a block reason continues the turn.
here=$(dirname "$0")
text=$(sh "$here/venom-hook.sh" stop 2>/dev/null)
[ -n "$text" ] || exit 0
printf '{"decision":"block","reason":"%s"}\n' "$text"
exit 0
