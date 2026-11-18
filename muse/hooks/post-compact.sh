#!/bin/sh
# Venom for Muse Code: PostCompact runs venom-hook.sh compacted. See emit.sh.
exec sh "$(dirname "$0")/emit.sh" compacted PostCompact context
