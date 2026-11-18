#!/bin/sh
# Venom for Muse Code: Stop runs venom-hook.sh stop. See emit.sh.
exec sh "$(dirname "$0")/emit.sh" stop Stop block
