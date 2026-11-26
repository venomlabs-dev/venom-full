# Venom hooks for Crush

Crush (charmbracelet) has no plugin system, only MCP servers, skills and hooks, and its hooks are marked preliminary. This folder adds the part of Venom's reminders that Crush can carry: a hook can add text to the model's context only on the tool events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`), so Venom's session-start and compaction texts ride on the next tool call, and milestone reminders (commit, push, PR, merge, release, deploy, publish) come after the shell tool.

## Install Venom Full

1. Venom Full for Crush starts with the server and rules. Add the Venom MCP server to Crush with OAuth switched on (see "OAuth" below), and put Venom's rules in your `AGENTS.md` (the `venom` plugin from venomlabs-dev/plugin has the text).
2. Clone this repo and run the installer from the clone:

```sh
git clone https://github.com/venomlabs-dev/venom-full
sh venom-full/crush/install.sh --apply
```

It writes `~/.config/crush/venom.crushrc` (hook lines with absolute paths) and adds `source ".../venom.crushrc"` to `~/.config/crush/crushrc`. Without `--apply` it only prints the lines. Crush runs hook commands from the project directory and has no plugin-root variable, so a global hook needs the absolute path; move the clone and run the installer again.

Same lines by hand (`crushrc`):

```bash
hook add PreToolUse --name venom-context --command "/ABS/venom-full/crush/hooks/crush-hook.sh pre-tool" --timeout 10
hook add PostToolUse --name venom-milestones --matcher '^(bash|mcp_.*(append_task_log|append_project_log|edit_log_entry))$' --command "/ABS/venom-full/crush/hooks/crush-hook.sh post-tool" --timeout 10
hook add PostCompact --name venom-compacted --command "/ABS/venom-full/crush/hooks/crush-hook.sh mark-compacted" --timeout 10
```

Or the older JSON form in `crush.json` (still supported, deprecated):

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "/ABS/venom-full/crush/hooks/crush-hook.sh pre-tool", "timeout": 10 }],
    "PostToolUse": [{ "matcher": "^(bash|mcp_.*(append_task_log|append_project_log|edit_log_entry))$", "command": "/ABS/venom-full/crush/hooks/crush-hook.sh post-tool", "timeout": 10 }],
    "PostCompact": [{ "command": "/ABS/venom-full/crush/hooks/crush-hook.sh mark-compacted", "timeout": 10 }]
  }
}
```

## OAuth for the Venom server

Crush supports OAuth for HTTP and SSE MCP servers, but only when asked. Without `oauth: true` it sends no sign-in flow and shows the server's 401 as a plain "Unauthorized" (what 0.101.0 did with the config from the plugin). Use:

```json
{
  "mcp": {
    "venom": { "type": "http", "url": "https://mcp.venomlabs.dev", "oauth": true }
  }
}
```

Crush then uses its built-in authorization-code flow with dynamic client registration (Venom supports it). With the flag, 0.101.0 logs "MCP server requires OAuth authentication" instead of "Unauthorized" and the sign-in is offered in the TUI.

## What it adds

| Crush event | Core event | Output |
| --- | --- | --- |
| `PreToolUse` (any tool), first call of a session | `session-start` | `{"context": "..."}` (skipped if that first call is already a Venom tool) |
| `PostCompact` (observe only), then next `PreToolUse` | `compacted` | marker now, `context` on the next tool call |
| `PostToolUse` on `bash` | `post-tool` | `{"context": "..."}` milestone, repeat limit 5 minutes |
| `PostToolUse` on Venom log tools | `post-tool` | nothing; clears the pending stop question |

## Limits

- No stop question: `TurnEnd` is observe-only, so nothing can ask "log this?" at the end of a turn. The milestone note after the command is the nudge.
- No pre-compaction text (`PreCompact` can only block) and no subagent text: Crush fires no hooks inside subagents, and the outer task call can only be rewritten, not annotated.
- Session start arrives with the first tool result, not before the first reply.
- Your projects and unread mentions at session start come with the sign-in (`sh hooks/venom-hook.sh login` in this folder's installed copy; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Built and unit-tested; not yet seen in a live session of this agent.
- Hooks are `command` only, and a path with spaces needs hand-quoting.
- JSON from Crush escapes `&`, `<`, `>`; the wrapper restores them so `cd x && git commit` is seen.

## Verified

Crush 0.101.0 (npm `@charmland/crush`, macOS arm64, isolated HOME, no sign-in, no telemetry): with the lines above in a project `.crushrc` and a local mock OpenAI-compatible model that asks for `git commit`, Crush logged `Hook completed` for PreToolUse/PostToolUse, and the model's next request carried the session-start text and then the commit milestone inside the bash tool result. `node --test crush/test/crush.test.mjs` passes (payload shapes from Crush's docs/hooks/README.md plus a captured real payload). Not verified: PostCompact marker and Venom log-tool matcher inside a live Crush (no compaction or Venom tool in the mock), exact MCP tool name pattern `mcp_<server>_<tool>` (from the docs' `^mcp_` matcher), the TUI sign-in prompt.
