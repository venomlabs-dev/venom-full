# Venom Hooks for Antigravity

Hooks for Google Antigravity (CLI `agy`, IDE and app) that remind the agent to
use Venom: at session start, and after a milestone (commit, push, pull request,
merge, release, closed issue, workflow run, deploy, publish) to log the
outcome. If a turn ends after a merge, release, workflow, deploy or publish
with nothing logged to Venom, Venom asks once more. This package has hooks
only: install the `venom` plugin first for the MCP server and skill.

## Install

```bash
agy plugin install https://github.com/venomlabs-dev/plugin     # venom plugin first
agy plugin install https://github.com/venomlabs-dev/venom-full/tree/main/antigravity   # untested
```

From a local clone: `agy plugin install /path/to/venom-full/antigravity`.
Check with `agy plugin list` (venom-hooks shows "1 hook") or `/hooks` in the TUI.

## What it adds

| Antigravity event | Venom event | Output |
|---|---|---|
| `SessionStart` | session-start | `injectSteps` `systemMessage` |
| `PostToolUse` (`run_command`, Venom log tools) | post-tool | cannot add text: remembers the reminder |
| `PreInvocation` (next model call) | post-tool, delivered | `injectSteps` `ephemeralMessage` |
| `Stop` | stop | `decision: continue` + `reason` |

Skipped: compaction and subagent start (Antigravity has no such hook events).
`PostToolUse` output is ignored by Antigravity (tested), so the milestone text
is saved by `PostToolUse` and injected by the next `PreInvocation`, which
always follows a tool result.

## Limits

- No projects or mentions list at session start (needs a signed-in client).
- No subagent or compaction guidance.
- Venom log tools are recognised by name containing `append_task_log`,
  `append_project_log` or `edit_log_entry`; the exact MCP tool name Antigravity
  uses was not checked (Venom MCP not signed in there).
- The wrapper relies on hooks running with the plugin root as working
  directory (verified on 1.5.11) and uses relative paths.
- Not verified: that `{"decision":"continue","reason":...}` from `Stop` makes
  Antigravity continue the turn (only the shape was written from the docs; the
  Stop path is covered by wrapper tests only).

## Verified

Antigravity CLI 1.5.11, isolated home, `gemini-3.8-flash-low`: `agy plugin
validate` and `install` from the local folder pass; hooks run with cwd and
`PLUGIN_ROOT` set to the installed plugin; SessionStart text and the commit
milestone text both reached the model (the model quoted them back). Stop and
log-tool clearing are covered by `node --test antigravity/test/antigravity.test.mjs`
only: the CLI was not run again after a keychain check (the binary references
the macOS keychain). Not tested: GitHub subfolder install, IDE and app.
