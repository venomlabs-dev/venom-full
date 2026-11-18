# Venom for Cline

Adds Venom reminders to Cline's context at the right moments, so the agent
uses Venom without being asked: a note before its first reply to find the
Venom project and task, and a note after a commit, push, pull request, merge,
release, deploy or publish to log the outcome. It works in the Cline CLI and
in the Cline VS Code extension. It has two parts: two hook files (both hosts)
and a one-file plugin (CLI only, adds the session-start note there).

Install the `venom` plugin or the Venom MCP server, rule and skill first
(see [venomlabs-dev/plugin](https://github.com/venomlabs-dev/plugin)); these
hooks only add the reminders.

## Install

Hook files, for the CLI and VS Code, all projects:

```bash
git clone https://github.com/venomlabs-dev/venom-full
sh venom-full/cline/install.sh
```

This copies `TaskStart`, `PostToolUse` and two helper scripts to
`~/Documents/Cline/Hooks`, which Cline reads for every project. For one
project only, give a folder: `sh venom-full/cline/install.sh <project>/.cline/hooks`
(CLI) or `<project>/.clinerules/hooks` (VS Code). In the VS Code extension, turn
on **Enable Hooks** in Cline's Feature Settings. On the CLI, hooks are off in
`--yolo` mode.

Cline runs only one `TaskStart` and one `PostToolUse` file per hooks folder.
If the folder already has one of those that isn't Venom's, the installer stops
with a message and changes nothing: merge by hand (call
`sh venom-cline.sh task-start` or `post-tool` from your own file), move yours
away, or give another folder. Re-running it over Venom's own files is fine.

CLI plugin, for the session-start note (the CLI doesn't pass a TaskStart
hook's output to the model):

```bash
cline plugin install https://github.com/venomlabs-dev/venom-full/blob/main/cline/plugin/venom.js
```

(`--cwd .` installs it for the current project only.) Check it with
`cline config`. Plugins don't load in the VS Code extension yet; there the
`TaskStart` hook file does the same job.

## What it adds

| Cline event | Host | What Venom adds |
| --- | --- | --- |
| `TaskStart` hook file | VS Code | The session-start note, once per task. Said as the subagent note when the run has a parent agent. |
| plugin `beforeRun` (`appendContext`) | CLI | The same note, once per session id from the plugin's snapshot (the field name is not documented, so `conversationId`, `sessionId`, `taskId` and `agentId` are tried; with none it is once per process). |
| `PostToolUse` hook file, after `run_commands` | CLI, VS Code | A reminder to log after a commit, push, PR, merge, release, closed issue, workflow run, deploy or publish: once per kind per 5 minutes. |

Every note goes to the model as `contextModification` (hook files) or
`appendContext` (plugin), which Cline adds to the conversation as a hook
context block on the next model request.

## Limits

- No end-of-turn question ("nothing was logged after the merge"): Cline's
  `TaskComplete` and `TaskCancel` hooks can't add context or keep the agent
  going. No compaction notes either: `PreCompact` isn't wired in Cline yet.
- Subagent notes only show if Cline runs hooks or plugins in subagent
  sessions; not checked.
- Projects and unread mentions at session start need a signed-in client:
  planned later.
- The hook files print `{"cancel":false}` when there is nothing to add
  (Cline's docs require the `cancel` field), instead of nothing.
- Hook files run for every tool call: they cost a few milliseconds and run in
  POSIX `sh` (macOS, Linux, WSL). Cline doesn't run hooks on Windows.
- Don't install the plugin and rely on `TaskStart` in the CLI at the same time
  if a Cline release starts honoring TaskStart output there: the note would
  appear twice. Remove one then.

## Verified

Cline CLI 3.0.74 and the Cline source on GitHub (docs.cline.bot hooks and
plugins pages, `sdk/examples/hooks`, `apps/vscode/src/sdk/hooks-adapter.ts`,
`sdk/packages/core/src/hooks`):

- `node --test cline/test/cline.test.mjs` passes: the hook files with the CLI
  and VS Code payload shapes (session start once per task, milestones,
  non-milestones, repeat limit, a Venom log call, empty input) and the plugin's
  `beforeRun`.
- `node scripts/sync-shared.mjs --check` passes.
- Not run: the Cline CLI itself. It reads a keychain entry with the macOS
  `security` tool at startup, which can't be used under a test HOME, so
  neither the hook discovery nor the plugin install (`cline plugin install`,
  `cline config`) was run, and the Cline VS Code extension was not tried.
  What Cline passes to hooks and plugins comes from the documented payloads
  and the source above, not from a live run.
