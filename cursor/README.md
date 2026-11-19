# Venom Hooks for Cursor

Hooks for Cursor and the Cursor CLI that keep the agent using Venom: a
session-start note to find the Venom project and task, a reminder to log after a commit,
push, PR, merge, release or deploy, one more nudge at the end of the turn if a
merge, release, workflow run, deploy or publish was never logged, and a
read-only note for subagents. It adds hooks only. Install the `venom` plugin
first (it has the MCP server, the rule and the skill).

## Install

1. Install `venom` (Cursor Marketplace once listed; until then, clone
   `venomlabs-dev/plugin` into `~/.cursor/plugins/local/venom`).
2. Install this package. Cursor Marketplace once listed. Until then:

```bash
git clone https://github.com/venomlabs-dev/venom-full ~/venom-full
cp -R ~/venom-full/cursor ~/.cursor/plugins/local/venom-hooks
```

Then run **Developer: Reload Window** in Cursor. Cursor skips symlinks that
leave the plugin folder, so copy instead of linking. The Cursor CLI can load
the same folder for one run: `cursor-agent --plugin-dir ~/venom-full/cursor`.

### User-level hooks (Cursor CLI, or if plugins don't load)

Copy the scripts and add the hooks to `~/.cursor/hooks.json` (merge by hand if
the file exists; Cursor runs user hooks from `~/.cursor/`):

```bash
mkdir -p ~/.cursor/hooks/venom
cp ~/venom-full/cursor/hooks/*.sh ~/.cursor/hooks/venom/
```

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "./hooks/venom/cursor-hook.sh session-start", "timeout": 10 }],
    "subagentStart": [{ "command": "./hooks/venom/cursor-hook.sh subagent", "timeout": 10 }],
    "postToolUse": [
      { "matcher": "Shell", "command": "./hooks/venom/cursor-hook.sh post-tool", "timeout": 10 },
      { "matcher": ".*(append_task_log|append_project_log|edit_log_entry).*", "command": "./hooks/venom/cursor-hook.sh post-tool", "timeout": 10 }
    ],
    "stop": [{ "command": "./hooks/venom/cursor-hook.sh stop", "timeout": 10, "loop_limit": 1 }]
  }
}
```

Grok Build reads `.cursor/hooks.json` in the same format, so the same file
works in a project's `.cursor/` there (use paths relative to the project).

## What each event adds

| Cursor event | Venom adds | Output field |
|---|---|---|
| `sessionStart` | find the Venom project and task, check mentions (no project or mention list: only the Claude Code and Codex plugins show those) | `additional_context` |
| `subagentStart` | read Venom but don't write; report to the parent | `additional_context` (see limits) |
| `postToolUse`, `Shell` | after commit/push/PR/merge/release/workflow/deploy/publish: log the outcome (once per 5 min) | `additional_context` |
| `postToolUse`, Venom log tools | clears the pending end-of-turn question | none |
| `stop` | once after merge/release/workflow/deploy/publish with no Venom log after it: log it or finish | `followup_message` |

Not wired: `preCompact` (Cursor only accepts `user_message`, which doesn't
reach the model), no after-compaction event, `beforeSubmitPrompt` (documented
as unable to inject), `postToolUseFailure` (a failed command is no milestone).

## Limits

- Your projects and unread mentions at session start come with the sign-in (`sh hooks/venom-hook.sh login` in this folder's installed copy; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Built and unit-tested; not yet seen in a live session of this agent.
- `subagentStart` is documented to accept only `permission` and
  `user_message`. Cursor CLI 2026.11.17's hook protocol also defines
  `additional_context` for it, which is what we send. Not verified that it
  reaches the subagent; if Cursor ignores it, the hook does nothing.
- `stop`'s `followup_message` is submitted as the next user message, so the
  agent takes one more short turn. It fires at most once per 15 minutes, with
  `loop_limit` 1.
- Plugin hooks run command hooks only.

## Verified

- `node --test "cursor/test/*.test.mjs"` passes (wrapper with Cursor-shaped
  payloads: session start, subagent, milestone, non-milestone, stop once,
  stop skipped on abort, Venom log clearing stop; hooks.json and plugin.json
  wiring). `node scripts/sync-shared.mjs --check` passes.
- Cursor CLI 2026.11.17: `--plugin-dir` and plugin loading from
  `hooks/hooks.json` exist; the bundled hooks validator requires a numeric
  `version` and accepts our `timeout`, `matcher` and `loop_limit` (read from the
  CLI source). Not run live: the CLI needs a sign-in, and its bundle mentions the
  macOS keychain, so it was not run again after the check. The Cursor app was
  not tried.
