# Venom for Kimi Code CLI

A Kimi plugin that gives [Kimi Code CLI](https://code.kimi.com) the whole Venom
setup from one install: the Venom MCP server (`https://mcp.venomlabs.dev`), the
`venom` skill (loaded at session start) and hooks that remind the agent to use
Venom. It replaces installing the `venom` plugin separately for Kimi.

## Install

In Kimi Code (the plugin manifest is `kimi/kimi.plugin.json`, so install from a
clone of this repository; Kimi installs a whole repository or a local folder,
not a subfolder of a GitHub URL):

```bash
git clone https://github.com/venomlabs-dev/venom-full
```

then, in the Kimi TUI:

```text
/plugins install /path/to/venom-full/kimi
/reload
```

Sign in to Venom from `/plugins` (M: manage MCP servers). Plugins install per
user and apply to every project.

## What the hooks add

Kimi puts a hook's stdout into the model's context only for `UserPromptSubmit`.
Other events are fire-and-forget (checked in the 2.6.3 source and live), so
their text is queued and goes out with the next prompt.

| Kimi event | Venom core event | What the model gets |
| --- | --- | --- |
| `UserPromptSubmit` | `session-start` (first prompt of a session) | Find the Venom project and task, check mentions, log before the final reply. Also any queued reminders below. Arrives as `<hook_result>` stdout. |
| `PostToolUse` (Bash) | `post-tool` | After a commit, push, PR, merge, release, deploy or publish, the milestone reminder, queued for the next prompt (5-minute repeat limit). |
| `PostToolUse` (Venom log tools) | `post-tool` | Nothing; clears the pending stop question and queued reminders. |
| `PostCompact` | `compacted` | After compaction, re-read the Venom task. Queued for the next prompt. |
| `Stop` | `stop` | After a merge, release, workflow, deploy or publish with nothing logged, once: exit 2 with the reason makes Kimi continue the turn with it. |

Skipped: `SessionStart` and `SubagentStart` (output ignored; session start is
covered by the skill plus the first-prompt text), `PreCompact` (return value
ignored by Kimi), `PreToolUse` (can only veto).

## Limits

- Milestone reminders after a commit or push arrive with the next prompt, not
  right after the command.
- Subagents get no "report to your parent" note: Kimi can't inject into them.
- No projects or unread-mentions list yet: that needs a signed-in client.
- `kimi -p` (headless) ends before a Stop continuation can run.

## Verified

Kimi Code 2.6.3, macOS, with a local OpenAI-compatible stub as the model (no
sign-in): `UserPromptSubmit` stdout arrives in the first request as a
`<hook_result>` block; `PostToolUse` stdout does not reach the model; `Stop`
and `PostCompact` semantics read from the 2.6.3 source. `node --test
kimi/test/kimi.test.mjs` covers the wrapper with payloads shaped like the live
ones. Not verified: `/plugins install` of this folder, plugin hooks firing from
the managed copy (`KIMI_PLUGIN_ROOT`), MCP sign-in, and a live Stop
continuation in the TUI.
