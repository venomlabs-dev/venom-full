# Venom hooks for Auggie

[Venom](https://venomlabs.dev) makes the coding agents your team already uses
multiplayer. The `venom` plugin gives Auggie the Venom skill and MCP server;
this folder makes Auggie remember to use them. It has two parts:

- a **plugin** (`hooks/hooks.json`) with a `PostToolUse` hook on the `bash`
  tool: after a commit, push, pull request, merge, release, closed issue,
  workflow run, deploy or publish, a short note is added to the tool result
  reminding the agent to log the outcome in Venom;
- an **extension** (`extensions/venom.js`) that adds the session-start note,
  the subagent note and the after-compaction note. Auggie hooks cannot do
  these: `SessionStart` output is not added to the model's context, and
  plugins cannot carry rules.

## Install

Install the `venom` plugin first (skill and MCP server):

```bash
auggie install git:github.com/venomlabs-dev/plugin
auggie mcp add venom -t http -u https://mcp.venomlabs.dev
```

The hooks plugin, from this repository:

```bash
auggie plugin marketplace add venomlabs-dev/venom-full
```

then press Space on `venom-full` in `/plugins` to enable it (or set
`"enabledPlugins": { "venom-full@venom-full": true }` in `~/.augment/settings.json`).
This needs `.augment-plugin/marketplace.json` at the repository root (source
`./auggie`), which is not added yet. Until then, from a clone:

```bash
git clone https://github.com/venomlabs-dev/venom-full
auggie --plugin-dir ./venom-full/auggie        # loads and enables it for that run
```

The session-start extension (optional, local clone; `auggie install` cannot take
a git subfolder):

```bash
auggie install ./venom-full/auggie
```

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
- No project or mention lists yet: that needs a signed-in client.

## Verified

Auggie 1.2.2 (`@augmentcode/auggie`), isolated HOME, not signed in, so no
model turn was run:

- A stand-in git repository with the root marketplace described above:
  `auggie plugin marketplace add file://...` cloned it; with
  `enabledPlugins` set, `auggie --check-startup` reported no problems, and
  reported `[venom-full@venom-full] failed to parse hooks/hooks.json` when the
  file was broken, so the loader reads our `hooks/hooks.json`.
- `auggie --plugin-dir <this folder>` loads the plugin the same way.
- `auggie install <this folder>` adds the package (`auggie list`), and
  `--check-startup` loaded the extension without errors (and reported the
  error when it was broken).
- `node --test auggie/test/*.test.mjs`: the hook wrapper with a payload in the
  documented shape, the extension handlers with fake events.

Not verified: the hook actually firing and the model receiving the text (needs
a signed-in session); the extension's subagent and compaction paths (read from
the bundled code only).
