# Venom Hooks for GitHub Copilot

Hooks for the `venom` plugin in GitHub Copilot CLI and in VS Code agent mode
(both run the same Copilot harness and hook format). They add short Venom
reminders to what the model sees: at session start, when a subagent starts,
after a commit, push, pull request, merge, release, deploy or publish, and
once more before the turn ends if an outcome was never logged.

This folder is an [Agent Plugins](https://agent-plugins.org) package named
`venom-hooks`. It has no MCP server or skill: install the `venom` plugin first.

## Install

```bash
copilot plugin marketplace add venomlabs-dev/plugin
copilot plugin install venom@venom
copilot plugin install venomlabs-dev/venom-full:copilot   # untested; the local-clone form below was checked
```

From a local clone: `copilot plugin install /path/to/venom-full/copilot`.
Copilot marks direct installs (repository, URL, local path) as deprecated in
favour of `plugin@marketplace`, so the marketplace entry below is the
long-term route.

VS Code picks up plugins installed by the CLI from `~/.copilot/installed-plugins/`
and lists them under Plugins in the Agent Customizations editor. You can also
use Chat: Install Plugin from Source. Select the Copilot harness (Session
Target) so these hooks run. Hooks need `sh`: macOS, Linux and WSL.

## What each event adds

| Copilot event | Core event | What Venom adds |
| --- | --- | --- |
| `SessionStart` | `session-start` | `additionalContext`: find the Venom project and task, check mentions. Arrives as a user message before your first prompt. |
| `SubagentStart` | `subagent` | `additionalContext`, prepended to the subagent's first message: read Venom, don't write, report to the parent. |
| `PostToolUse` (shell tool `Bash`, and Venom log tools) | `post-tool` | `additionalContext` appended to the tool result: milestone reminder after commit, push, PR, merge, release, issue close, workflow run, deploy, publish. A Venom `append_task_log`, `append_project_log` or `edit_log_entry` call clears the pending stop question. |
| `Stop` | `stop` | `{"decision":"block","reason":...}`: asked once after a merge, release, workflow, deploy or publish with no Venom log after it. Copilot sends the reason to the model as the next prompt and sets `stop_hook_active`, so it never loops. |

Events are named in PascalCase on purpose: Copilot then sends snake_case
payloads with `tool_input` as an object, which the core reads. camelCase
events pass `toolArgs` as a JSON string.

PostToolUse and Stop also fire inside subagents (payload has `agent_id`); the
wrapper stays silent there, as subagents report to their parent.

## Limits

- No compaction reminders: Copilot's `preCompact` is notification-only and
  there is no post-compaction event.
- `userPromptSubmitted` output is dropped for config hooks, so no per-prompt
  mentions. The projects and mentions list at session start (as in Claude
  Code) comes with the sign-in; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions).
- The built-in `general-purpose` subagent doesn't emit `subagentStart`.
- A shell command that fails still counts as a milestone: Copilot reports it
  as a successful tool call.

## Verified

Copilot CLI 1.0.114 (npm `@github/copilot`), isolated HOME, no sign-in. The CLI
ran against a local OpenAI-compatible mock (`COPILOT_PROVIDER_BASE_URL`,
`COPILOT_OFFLINE=true`) that scripted tool calls:
`copilot plugin install <local>/copilot` installs and `plugin list` shows
`venom-hooks (v0.10.0)`; the session start text reached the model as a user
message; a `git commit` and a `gh pr merge` result carried the milestone
text; a merge with no log was followed by the stop reason as a new user turn,
then silence; a fake `venom-append_task_log` MCP call cleared it; an `explore`
subagent received the subagent text. Not run: VS Code (needs the app and a
Copilot sign-in) and installs from GitHub or a marketplace (the CLI binary
could not be cleared as keychain-free, so it was not run again after those
steps). `node --test 'copilot/test/*.test.mjs'` runs the wrapper tests.
