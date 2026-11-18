#!/bin/sh
# Venom for Muse Code: PreCompact runs venom-hook.sh pre-compact. See emit.sh.
exec sh "$(dirname "$0")/emit.sh" pre-compact PreCompact context
