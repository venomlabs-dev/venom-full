# Venom hooks for Mistral Vibe

A Vibe-native plugin (Agent Plugins 1.0, experimental in Vibe) that adds hooks to the Venom setup in Mistral Vibe CLI and the Vibe desktop app. It keeps the agent using [Venom](https://venomlabs.dev): a reminder at session start, a reminder to log after commits, pushes, PRs, merges, releases, deploys and publishes, a one-time question at the end of a turn if a merge, release, workflow, deploy or publish was never logged, and a note for subagents to report to their parent instead of writing.

It has no MCP server or skill of its own. Venom Full for Vibe is the `venom` plugin (the Venom server and skill) plus this package, as the steps below install them.

## Install Venom Full

```bash
# 1. Venom Full, step 1: the Venom server and skill
git clone https://github.com/venomlabs-dev/plugin ~/.vibe/plugins/venom

# 2. Venom Full, step 2: these hooks (only the vibe/ folder: the repository root is a Claude Code plugin, and Vibe would load it as one)
git clone --depth 1 --filter=blob:none --sparse https://github.com/venomlabs-dev/venom-full /tmp/venom-full
git -C /tmp/venom-full sparse-checkout set vibe
cp -R /tmp/venom-full/vibe ~/.vibe/plugins/venom-hooks
rm -rf /tmp/venom-full
```

Then restart Vibe or run `/reload-plugins`, and check `/plugins`: `venom-hooks` should list four hooks.

Sign in to Venom in a new chat: run `/mcp status`, then `/mcp login` with the server whose name ends in `_venom`. Vibe names the `venom` plugin's server `plugin_<id>_venom`, with an id that differs on each machine, and doesn't start its sign-in by itself. Don't add a server named `venom`: it would be a second Venom server. Then run `sh ~/.vibe/plugins/venom-hooks/hooks/venom-hook.sh login` once and approve the link it prints, so each new chat starts with your projects and unread mentions.

## What it adds

| Vibe event | Venom core event | What the model gets |
| --- | --- | --- |
| `session_start` (startup, resume, clear, fork) | `session-start` | `additional_context`: find the Venom project and task, check mentions, log before the final reply |
| `pre_agent`, subagent sessions only | `subagent` | `additional_context`, once per subagent session: read Venom, don't write, report to the parent |
| `post_tool` on `bash`, `process_start` | `post-tool` | `additional_context` appended to the tool output after a milestone (5-minute repeat limit) |
| `post_tool` on `append_task_log`, `append_project_log`, `edit_log_entry` | `post-tool` | nothing; clears the pending stop question |
| `post_agent`, main agent only | `stop` | `decision: deny` with the question as `reason`: Vibe sends it back as a user message. Asked once, only after merge, release, workflow, deploy or publish with no Venom log after it |

Skipped: pre- and post-compaction (Vibe has no compaction event), `notification` and `session_end` (their output is ignored), subagent start (no event; covered by `pre_agent`). Failed shell commands are not milestones.

## Limits

- Your projects and unread mentions at session start come with the sign-in (`sh hooks/venom-hook.sh login` in this folder's installed copy; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Seen in the Vibe app.
- The "stop" question uses Vibe's post_agent retry (at most 3 per turn). The agent may answer it with a short reply if nothing is worth logging.
- A forked session that carries a parent session id may be treated as a subagent (unverified).
- Plugins are experimental in Vibe and hooks run from the session's pinned plugin copy: update the plugin, then start a new session.

## How it was verified

Mistral Vibe 3.1.3 (uv tool, isolated home), Python API only:

- `inspect_plugin` on `vibe/`: valid, source format `agent_plugins_1_0`, four hooks, no diagnostics.
- `PluginResolver` on a home with `venom` and `venom-hooks` in `~/.vibe/plugins/`: both load; the four hooks resolve as `venom-hooks:*` with `PLUGIN_ROOT` and `PLUGIN_DATA` set. Each hook command was run the way Vibe runs it (shell, plugin root as cwd, that environment, payloads from Vibe's docs) and printed the expected JSON.
- The `match` patterns were checked against Vibe's own matcher (`bash`, `venom.append_task_log`, main versus subagent).
- `node --test vibe/test/*.test.mjs` (8 tests).

Live, in the Vibe app 3.1.3 on 21 Nov 2026, signed in to Venom and to the hooks: a new chat's model named the projects from the session-start text before its first Venom call, then used the Venom tools. Not seen live yet: the milestone reminder, the stop question and the subagent note.
