# Venom hooks for Factory Droid

`venom-hooks` is a Droid plugin that adds short Venom reminders to Droid's
context at the right moments: where to look at the start of a session, what to
keep after compaction, and when to log a milestone (commit, push, pull request,
merge, release, deploy, publish). It carries no MCP server of its own: Venom
Full for Droid is the `venom` plugin (the Venom server and the `venom` skill)
plus this package, installed in the steps below. The Claude Code and Codex hooks in this repository's root can't run in
Droid (they are `mcp_tool` hooks, which Droid ignores), so this folder is a
separate package of plain command hooks.

## Install Venom Full

```bash
droid plugin marketplace add venomlabs-dev/plugin
droid plugin install venom@plugin --scope user
droid mcp add venom https://mcp.venomlabs.dev --type http
droid plugin marketplace add venomlabs-dev/venom-full
droid plugin install venom-hooks@venom-full --scope user
```

Droid names each marketplace after its repository, so the plugins are
`venom@plugin` and `venom-hooks@venom-full`. The `droid mcp add` line is there
because Droid 1.14.0 doesn't accept the `venom` plugin's own server entry.

Don't install `venom-full` (the Claude Code plugin at the repository root) in Droid: its hooks are ignored and Droid warns about
each one. Then sign in to Venom from Droid's `/mcp` as usual.

For a local check, add a marketplace whose entry points at this folder (see
"Marketplace entry" below) or copy this folder into one and
`droid plugin marketplace add <path>`.

## What it adds

| Droid event | Core event | What Venom adds | Output field |
| --- | --- | --- | --- |
| `SessionStart` (startup, resume, clear) | `session-start` | Find the Venom project and task, check mentions | `additionalContext` |
| `SessionStart` (compact) | `compacted` | Re-read the task, log unlogged decisions | `additionalContext` |
| `SessionStart` in a Task subagent (input has `calling_session_id`) | `subagent` | Report to the parent instead of writing | `additionalContext` |
| `PostToolUse` on `Execute` | `post-tool` | Milestone reminder after commit, push, PR, merge, release, deploy, publish (once per 5 minutes) | `additionalContext` |
| `PostToolUse` on Venom log tools | `post-tool` | Clears the pending stop question | none |
| `Stop` | `stop` | After a merge, release, workflow, deploy or publish with no Venom log after it, asks once to log | `decision: block` + `reason` |

Skipped, and why:

- `PreCompact`: Droid keeps its output on the hook row; it never reaches the
  summarizer. The post-compaction `SessionStart` (`compact`) covers it.
- `SubagentStop` and `Notification`: cannot add model context.
- `UserPromptSubmit`: could carry context, but `SessionStart` already does and a
  per-prompt reminder would be noise.
- `PreToolUse`: its `additionalContext` is dropped by Droid.

## Limits

- Your projects and unread mentions at session start come with the sign-in (`sh hooks/venom-hook.sh login` in this folder's installed copy; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Built and unit-tested; not yet seen in a live session of this agent.
- The subagent note relies on `SessionStart` firing in Task subagent sessions
  with `calling_session_id` (documented, not observed: see below).
- The `Stop` question uses a block, so Droid starts one more short turn; it
  happens once, only after outcome-type milestones.
- Texts come from `shared/guidance.json`; run `node scripts/sync-shared.mjs`
  after changing them.

## Marketplace entry

Droid reads `.factory-plugin/marketplace.json` before `.claude-plugin/`. A
Droid-only catalog in `venomlabs-dev/plugin` keeps Claude Code's catalog
unchanged:

```json
{
  "name": "venom",
  "owner": { "name": "Venom Labs", "url": "https://venomlabs.dev" },
  "plugins": [
    { "name": "venom", "description": "Your team's agents share projects, tasks, decisions and skills through the Venom MCP server.", "source": "./", "category": "productivity" },
    {
      "name": "venom-hooks",
      "description": "Venom reminders for Droid: session start, compaction, milestones. Install venom too.",
      "source": { "source": "git-subdir", "url": "https://github.com/venomlabs-dev/venom-full", "path": "droid" },
      "category": "productivity"
    }
  ]
}
```

## Verified

- Droid 1.14.0 (isolated home, not signed in): a local marketplace entry with a
  relative source, and one with `git-subdir` (local git repo as stand-in),
  both installed `venom-hooks`; `droid plugin list` showed it Enabled with no
  hook issues, and the cache held `.factory-plugin/`, `hooks/hooks.json` and
  executable scripts.
- Wrappers run against payloads shaped like the docs' hook input:
  `node --test "droid/test/*.test.mjs"` (Node 26 does not accept a bare
  directory argument).
- Not verified: a live turn. `droid exec` stops with "Authentication failed",
  so what the model receives, the `Stop` block and the subagent `SessionStart`
  are checked against Droid's documentation only.
