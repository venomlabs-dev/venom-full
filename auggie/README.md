# Venom Full for Auggie

[Venom](https://venomlabs.dev) makes the coding agents your team already uses
multiplayer. This folder is Venom Full for Auggie, in two parts:

- a **plugin** (`venom-full`) with the Venom MCP server (`.mcp.json`), the
  `venom` skill, an always-on rule (`rules/venom.md`) and a `PostToolUse` hook
  on the `bash` tool: after a commit, push, pull request, merge, release,
  closed issue, workflow run, deploy or publish, a short note is added to the
  tool result reminding the agent to log the outcome in Venom;
- an **extension** (`extensions/venom.js`) that adds the session-start note
  (with your projects and unread mentions once signed in), the subagent note
  and the after-compaction note. Plugins can't carry extensions, so it is a
  second, optional step.

## Install

```bash
auggie plugin marketplace add venomlabs-dev/venom-full
```

Then enable `venom-full` in `/plugins` (press Space), or add
`"venom-full@venom-full": true` under `enabledPlugins` in
`~/.augment/settings.json`. Start a new session and sign in to Venom from
`/mcp`. Don't run `marketplace add` again to update: Auggie 1.2.2 adds a
second copy of the marketplace instead (it has no CLI update command).

The extension, for the session-start, subagent and compaction notes:

```bash
git clone --depth 1 https://github.com/venomlabs-dev/venom-full ~/.venom-full
auggie install ~/.venom-full/auggie
sh ~/.venom-full/shared/venom-hook.sh login   # your projects and mentions at session start
```

Update it with `git -C ~/.venom-full pull`. `auggie install` of this folder
loads only the extension (`package.json` lists it), not the skill again.

### Upgrading from venom-hooks

Before 0.14.0 the plugin was `venom-hooks` (hooks only), with the server added
by `auggie mcp add venom` and the skill from `auggie install
git:github.com/venomlabs-dev/plugin`. Once your copy of the marketplace has
0.14.0, `venom-hooks` is gone from it and its hook stops: enable `venom-full`
in `/plugins`. Then remove the old pieces so Venom isn't there twice:
`auggie mcp remove venom` (`auggie mcp list` shows only servers added by hand,
not the plugin's) and `auggie remove git:github.com/venomlabs-dev/plugin`.

## What it adds

| Auggie event | Core event | What the model gets |
|---|---|---|
| `PostToolUse`, tool `bash` (commit, push, PR, merge, release, issue close, workflow, deploy, publish) | `post-tool` | `hookSpecificOutput.additionalContext`: the milestone note, once per kind every 5 minutes |
| Extension `before_agent_start` (first prompt) | `session-start` | A hidden message: find the Venom project and task, check mentions, log before the final reply |
| Extension `before_agent_start` in a subagent session (`ctx.role === "subagent"`) | `subagent` | A hidden message: report to the parent, do not write to Venom |
| Extension `session_compact` | `compacted` | A hidden message for the next prompt: re-read the task |

Texts are the shared Venom texts (`hooks/venom-hook.sh`, `guidance.json`).

## Limits

- **No stop question.** Auggie's `Stop` hook output only reaches the user, so
  the "nothing was logged after the merge" question is not possible.
- **No pre-compaction text.** Auggie has no hook before compaction, and
  extensions cannot add to the summary.
- **No log-tool hook.** It would only clear the stop question, which does not
  exist here.
- The plugin only matches `bash`. Auggie runs the hook on subagent tool calls too.
- Extensions are Auggie 1.x's pi-based extension API (a preview). The hooks
  plugin does not depend on it.
- Your projects and unread mentions at session start come with the sign-in (`sh hooks/venom-hook.sh login` in this folder's installed copy; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Built and unit-tested; not yet seen in a live session of this agent.

## Verified

Auggie 1.2.2 (`@augmentcode/auggie`), isolated HOME, not signed in. Auggie
only runs Augment's own models, so no model turn was run:

- `auggie plugin marketplace add file://<this repository>` installed the
  `venom-full` marketplace. Before `venom-full` was enabled nothing loaded.
  With `enabledPlugins` set, in `--mode rpc`, `get_commands` listed
  `skill:venom` from `auggie/skills/venom`, `/mcp` listed
  `venom-full@venom-full/venom (auth required)`, and `--check-startup`
  reported no problems.
- From GitHub after the 0.14.0 release, in a fresh home: `auggie plugin
  marketplace add venomlabs-dev/venom-full`, then `venom-full` enabled, gave the
  same skill and server.
- With the extension also installed (`auggie install <this folder>`), the
  skill was still listed once and the startup check was clean.
- `auggie mcp list` lists only servers added by hand, and `auggie mcp remove
  venom` and `auggie remove git:github.com/venomlabs-dev/plugin` both work.
- Running `marketplace add` a second time installed a second marketplace
  (named after the folder), not an update.
- Earlier (venom-hooks): `--check-startup` reported a broken
  `hooks/hooks.json`, so the loader reads our hooks file; `auggie install
  <this folder>` loaded the extension.
- `node --test auggie/test/*.test.mjs`: the package layout, the hook wrapper
  with a payload in the documented shape, the extension handlers with fake
  events.

Not verified: the hook firing and the rule and extension texts reaching the
model (needs a signed-in Augment session); the extension's subagent and
compaction paths (read from the bundled code only). Auggie's startup check
doesn't report plugin rules, so the rule's loading isn't confirmed either.
