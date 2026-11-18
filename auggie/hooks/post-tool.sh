#!/bin/sh
# Auggie PostToolUse hook for the bash tool. Auggie sends the hook JSON on
# stdin (the shell command is in tool_input.command, the session in
# conversation_id). The shared core prints one line when the command is a
# milestone; it goes to the model as additionalContext, appended to the tool
# result. Prints nothing and exits 0 otherwise.
dir=$(dirname "$0")
text=$(sh "$dir/venom-hook.sh" post-tool 2>/dev/null) || exit 0
[ -n "$text" ] || exit 0
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$text"
exit 0
