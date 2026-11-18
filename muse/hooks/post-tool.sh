#!/bin/sh
# Venom for Muse Code: PostToolUse runs venom-hook.sh post-tool. See emit.sh.
exec sh "$(dirname "$0")/emit.sh" post-tool PostToolUse context
