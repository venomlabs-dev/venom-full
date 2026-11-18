#!/bin/sh
# Venom for Muse Code: SessionStart runs venom-hook.sh session-start. See emit.sh.
exec sh "$(dirname "$0")/emit.sh" session-start SessionStart context
