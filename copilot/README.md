# Venom Full for GitHub Copilot

One plugin for GitHub Copilot CLI and VS Code agent mode (both run the same
Copilot harness and hook format) that brings all of Venom:

- the Venom MCP server (`https://mcp.venomlabs.dev`, OAuth, no API key);
- the `venom` skill, which tells Copilot when to read and log Venom work;
- hooks that add short Venom notes to what the model sees: your Venom
  projects and unread mentions at session start (once signed in), a note when
  a subagent starts, a reminder after a commit, push, pull request, merge,
  release, deploy or publish, and one check before the turn ends if an outcome
  was never logged.

This folder is an [Agent Plugins](https://agent-plugins.org) 1.0 package named
`venom-full`: `plugin.json`, `mcp.json`, `skills/venom/SKILL.md` and
`com.github.copilot/hooks/hooks.json`.

## Install

```bash
copilot plugin marketplace add venomlabs-dev/plugin
copilot plugin install venom-full@venom
```

The `venom` marketplace (in [venomlabs-dev/plugin](https://github.com/venomlabs-dev/plugin))
lists this folder as `venom-full` for Copilot. Run `/mcp` in Copilot to sign in to `venom`. Then sign the hooks in once per
machine, so each session starts with your projects and mentions:

```bash
git clone --depth 1 https://github.com/venomlabs-dev/venom-full ~/.venom-full
sh ~/.venom-full/shared/venom-hook.sh login
```

From a local clone: `copilot plugin install ~/.venom-full/copilot` (Copilot
marks direct installs from a path or repository as deprecated). VS Code
picks up plugins installed by the CLI from `~/.copilot/installed-plugins/` and
lists them under Plugins in the Agent Customizations editor; without the CLI,
run **Chat: Install Plugin from Source** with a local clone's `copilot`
folder. Select the Copilot harness (Session Target) so the hooks run. Hooks
need `sh`: macOS, Linux and WSL.

### Upgrading from venom-hooks (0.12 and earlier)

This folder used to be a hooks-only plugin named `venom-hooks`, installed next
to `venom@venom`. Remove the old one so the hooks don't run twice:

```bash
copilot plugin uninstall venom-hooks
copilot plugin marketplace update venom
copilot plugin install venom-full@venom
```

You can also uninstall `venom@venom`, which is the server and skill without
hooks. If you keep it, Copilot's docs say a server name declared twice is used
once (the last one loaded, with a warning) and skills dedupe by name; that
pairing isn't in the live test. If both `venom-hooks` and `venom-full` stay
installed, the hooks answer once per event: the wrapper skips a payload it
has already answered.

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

CI runs [test/live/run.sh](test/live/run.sh) on Linux with Copilot CLI 1.0.114
(npm `@github/copilot`) against a stand-in model (`providers.json` with an
OpenAI-compatible mock, `COPILOT_OFFLINE=true`, no GitHub sign-in). It checks
that one install of this folder brings the skill ("Installed 1 skill"), the
`venom` server under `copilot mcp list` → Plugin servers, and the hooks; that
the session-start text and the skill's description reach the model; and that
after a real `git commit` tool call the milestone text comes back with the
tool result. On pushes to main it also installs `venom-full@venom` from the
published marketplace. First passing run: 22 Nov 2026. Not run: VS Code (needs
the app and a Copilot sign-in). `node --test 'copilot/test/*.test.mjs'` runs
the wrapper and package tests.
