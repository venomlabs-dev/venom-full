# Venom hooks for JetBrains Junie

A Junie extension that adds Venom reminders to Junie CLI (and Junie hosts that run hooks): your team's Venom projects and tasks on the first prompt of a session, a reminder to log the outcome after a commit, push, PR, merge, release, deploy or publish, and one "did you log it?" question at the end of a turn after an outcome-type milestone. It needs the `venom` extension (the Venom MCP server and skill) installed first.

## Install

```text
/extensions marketplace add venomlabs-dev/plugin
/extensions install venom
/extensions install venom-junie
```

`venom-junie` is listed in the Venom marketplace only once the plugin repository adds a subfolder entry for `venomlabs-dev/venom-full` (`junie/`). Until then, from a local clone of this repository:

```text
/extensions marketplace add /path/to/venom-full/junie
/extensions install venom-junie
```

Extension hooks are active only after the install through `/extensions`.

## What Junie gets

| Junie event | Venom core event | What Venom adds |
| --- | --- | --- |
| `UserPromptSubmit` (first prompt of a session; later prompts add nothing) | `session-start` | Find the Venom project and task, check mentions, create a task for new work, log before the final reply. |
| `PostToolUse` (`Bash`) | `post-tool` | After a commit, push, PR, merge, release, closed issue, workflow run, deploy or publish: log the outcome with evidence. Same milestone repeats at most every 5 minutes. |
| `PostToolUse` (Venom log tools: `append_task_log`, `append_project_log`, `edit_log_entry`) | `post-tool` | Prints nothing; clears the pending stop question. |
| `Stop` | `stop` | Once after a merge, release, workflow, deploy or publish with no Venom log call after it. `stop_hook_active` is respected. |

All output is `{"hookSpecificOutput":{"hookEventName":"...","additionalContext":"..."}}`, which Junie feeds to the model.

Skipped: `SessionStart` (Junie ignores its `additionalContext`, so the session-start text rides on the first `UserPromptSubmit` instead, gated once per session with a marker under `${TMPDIR:-/tmp}/venom-hooks-<uid>/`); `PreToolUse` (nothing to add before a tool runs); compaction and subagents (Junie has no hook for either; `SessionStart` with `source: compact` ignores context).

## Limits

- `UserPromptSubmit` runs only in the interactive TUI. In headless runs (`junie "task"`) and ACP/IDE hosts there is no session-start text; milestones and stop still work where those hosts dispatch `PostToolUse`/`Stop`.
- Junie sends `session_id` only on `SessionStart` and `UserPromptSubmit`. For `PostToolUse` and `Stop` the wrapper keys state by the Junie process id (`ps`, POSIX).
- Junie 26.9.7 (3110.7) documents `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`, `StopFailure`, `PermissionRequest` and `SessionEnd`; `PostToolUse` appears in the current online docs only. On a version without it, milestones and the Venom-log clearing do nothing (a Stop question may then never be armed).
- No projects/mentions list yet: that needs a signed-in client, planned later.

## Verified

- Wrapper tests (`node --test junie/test/junie.test.mjs`, Node 26.5.0) with payloads copied from the Junie hooks docs: session start once per session, milestone, non-milestone, repeat limit, stop once, Venom log clearing stop, `stop_hook_active`.
- Read against Junie's hooks and extensions docs and the docs bundled in Junie CLI 26.9.7 (3110.7).
- Not run: Junie itself. Junie writes to the macOS keychain at startup, which an isolated HOME breaks, so no install, `/extensions` listing or live hook run was done. The extension manifest (`extension.json` plus `.claude-plugin/plugin.json`) and the `junie/.claude-plugin/marketplace.json` source `./` form follow the Junie and Claude formats but are untested in Junie.
- The earlier hang in an isolated home: the TUI waits on first-run screens (anonymous-statistics question, then a login screen). It answers terminal queries fine with a PTY driver that replies to DA/DECRQM/OSC 11; `--share-anonymous-statistics=false` skips the first screen, but the login screen needs a sign-in or a custom model profile (`--model-location`).
