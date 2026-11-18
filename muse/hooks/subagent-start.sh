#!/bin/sh
# Venom for Muse Code: SubagentStart runs venom-hook.sh subagent. See emit.sh.
exec sh "$(dirname "$0")/emit.sh" subagent SubagentStart context
