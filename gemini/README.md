# Venom Hooks for Gemini CLI

Hooks that make Gemini CLI use [Venom](https://venomlabs.dev): a reminder at
session start to find the Venom project and task, a reminder to log after a
commit, push, pull request, merge, release, deploy or publish, and one
follow-up question at the end of a turn if an outcome was never logged. It is a
second Gemini CLI extension, `venom-hooks`, that holds hooks only. The `venom`
extension still provides the MCP server and skill.

## Install

```bash
# 1. The Venom server and skill
gemini extensions install https://github.com/venomlabs-dev/plugin --ref main

# 2. The hooks
git clone https://github.com/venomlabs-dev/venom-full
gemini extensions install ./venom-full/gemini
```

`gemini extensions install <github url>` clones the whole repository and
expects `gemini-extension.json` at its root, so it can't take the `gemini/`
subfolder (and the repository root must not carry one: it would load in
Claude Code and Codex). Use the local clone as above. While editing, use
`gemini extensions link ./venom-full/gemini` instead of install. Update with
`git pull` and `gemini extensions update venom-hooks` (or re-install).
Gemini asks once to trust the extension folder; project hooks from extensions
need that trust.

## What it adds

| Gemini CLI event | Venom core event | What reaches the model |
| --- | --- | --- |
| `SessionStart` (startup, resume, clear) | `session-start` | `hookSpecificOutput.additionalContext`: find the project and task, check mentions |
| `AfterTool` on `run_shell_command` | `post-tool` | `additionalContext`, appended to the tool result, after commit, push, PR, merge, release, closed issue, workflow run, deploy, publish (once per 5 minutes) |
| `AfterTool` on Venom log tools (`append_task_log`, `append_project_log`, `edit_log_entry`) | `post-tool` | nothing printed; clears the pending stop question |
| `AfterAgent` | `stop` | `{"decision":"deny","reason":...}`: Gemini sends the reason as a new prompt, so the agent gets one more turn to log. Asked once after merge, release, workflow, deploy or publish, only if no Venom log call followed. |

Skipped:

- `PreCompress`: Gemini fires it without reading hook output and there is no
  "after compaction" event, so nothing can reach the model or the summary.
- Subagents: Gemini has no subagent start event.
- `BeforeAgent`, `BeforeModel`, `Notification`, `SessionEnd`: not needed.

## Limits

- No list of your projects or unread mentions at session start: that needs a
  signed-in client (planned).
- Hooks only run when `hooksConfig.enabled` is true (the default).
- The `AfterAgent` question makes Gemini run one extra model turn.

## Files

`gemini-extension.json`, `hooks/hooks.json` (extension hooks, read from this
path by Gemini CLI), `hooks/gemini-hook.sh` (wrapper), `hooks/venom-hook.sh`
(shared core, synced by `node scripts/sync-shared.mjs gemini`), `test/`.

## Verified

Gemini CLI 0.68.0 (npm `@google/gemini-cli`, isolated home, no sign-in):
`gemini extensions install <local path> --consent` reached the folder trust
prompt (not completed). Event names, `hookSpecificOutput.additionalContext`,
the `hooks/hooks.json` loader (`{"hooks":{...}}`, with `${extensionPath}` and
`${/}` substituted) and PreCompress behavior were read from the 0.68.0 bundle
and the docs. `node --test gemini/test/gemini.test.mjs` runs the wrapper
against payloads shaped like the docs. A live turn was not run.
