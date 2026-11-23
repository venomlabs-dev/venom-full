# Venom Hooks for Devin CLI and Devin Desktop

Adds Venom reminders to the context of Devin CLI and of Devin Desktop's agent
(Devin Local, which replaced Windsurf's Cascade and, per Devin's docs, shares
Devin CLI's hooks and plugins; not tried) at the right moments, so the
agent keeps using Venom without being told: at the start of a session, after a
shell command that commits, pushes, opens or merges a pull request, releases,
deploys or publishes, and once at the end of a turn if an outcome-type step
(merge, release, workflow run, deploy, publish) was never logged. It needs the
Venom MCP server and skill, from the
[`venom`](https://github.com/venomlabs-dev/plugin) plugin or its Devin config
(`.devin/mcp_config.json` plus the `AGENTS.md` rule, then `devin mcp login venom`).

Level: Plugin + some hooks. Hooks use the shared core
[`hooks/venom-hook.sh`](hooks/venom-hook.sh) through the wrapper
[`hooks/devin-hook.sh`](hooks/devin-hook.sh).

## Install

The simplest route is the [`venom`](https://github.com/venomlabs-dev/plugin)
plugin, which installs these hooks with it as a required plugin, along with the
Venom server, the skill and an always-on rule:

```bash
devin plugins install venomlabs-dev/plugin
```

Installing plugins needs `devin auth login`. Update with `devin plugins update`.
To sign the hooks in, so each session starts with your projects and mentions:

```bash
git clone --depth 1 https://github.com/venomlabs-dev/venom-full ~/.venom-full
sh ~/.venom-full/shared/venom-hook.sh login
```

Hooks only, as a plugin: `devin plugins install venomlabs-dev/venom-full#devin`.

Without plugins, a hooks file (checked with `devin migrate hooks`, no Devin
login needed). Clone once, then add the hooks to a project or to your user
config:

```bash
git clone --depth 1 https://github.com/venomlabs-dev/venom-full ~/.venom-full

# one project (Devin also reads this from parent folders up to the repo root)
mkdir -p .devin && cp ~/.venom-full/devin/hooks.v1.json .devin/hooks.v1.json
```

For every project, paste the same three events under a `"hooks"` key in
`~/.config/devin/config.json` (the contents of `hooks.v1.json` are the value).
If you already have hooks there, add the three entries to your existing events.
Run `/hooks` in Devin to see what is loaded. Update with
`git -C ~/.venom-full pull`. Each command checks that the script exists and
exits quietly (status 0) if not.

## What each Devin event adds

| Devin event | Matcher | Core event | What Venom adds | Output field |
| - | - | - | - | - |
| `SessionStart` | all | `session-start` | Find the Venom project and task, check mentions, log before the final reply | `hookSpecificOutput.additionalContext` |
| `PostToolUse` | `exec` | `post-tool` | After commit, push, PR, merge, release, closed issue, workflow run, deploy or publish: log the outcome with evidence (at most once per kind every 5 minutes) | `hookSpecificOutput.additionalContext` |
| `PostToolUse` | Venom `append_task_log`, `append_project_log`, `edit_log_entry` | `post-tool` | Nothing printed; clears the pending end-of-turn question | none |
| `Stop` | all | `stop` | Once after a merge, release, workflow, deploy or publish with no Venom log after it: log if there is something worth recording, otherwise just finish | `decision: block` with `reason` |

## Not wired, and why

- **Before compaction, subagent start**: Devin has no such events. Its events
  are `PreToolUse`, `PostToolUse`, `PermissionRequest`, `UserPromptSubmit`,
  `Stop`, `PostCompaction`, `SessionStart` and `SessionEnd`.
- **After compaction** (`PostCompaction`): the docs give no output field that
  reaches the model, so it isn't wired. If Devin adds one, map it to the core's
  `compacted` event.
- **`UserPromptSubmit`**: can inject context, but the core has nothing for it.
- Your projects and unread mentions at session start come with the sign-in (see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Seen in a live Devin CLI session.
- Each hook command exits quietly if its script is missing, and `Stop` is a block
  decision, so a rare extra turn is possible (the core asks at most once per
  15 minutes).

## Verification

Live, 23 November 2026, Devin CLI 3000.14.30821 on macOS, signed in to Devin
and Venom, installed with `devin plugins install venomlabs-dev/plugin -y`:

- Devin installed `venom-hooks` as the `venom` plugin's required plugin.
  `devin plugins info venom-hooks` lists the three hooks, with the
  `${DEVIN_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}}` commands, so the
  `hooks.json` wrapper shape is read.
- In a headless `devin -p` session in a scratch repository, the session-start
  note reached the model with the signed-in projects, unread mentions and the
  session tag, and a real `git commit` brought back the milestone note.
- Not seen live: the end-of-turn `Stop` question (no merge or deploy in the
  test), and Devin Desktop.

Unit tests: `node --test devin/test/devin.test.mjs` runs the wrapper with
payloads in the shape of the Devin docs (session start, milestone,
non-milestone, stop once, Venom log clearing stop). `devin migrate hooks`
confirmed the `.devin/hooks.v1.json` shape (events at the top level, no
wrapper key) and that the shell tool is named `exec`.
