# Venom Full for OpenHands

One plugin for OpenHands (Agent Canvas, OpenHands Cloud and scripts on the
OpenHands Software Agent SDK, which all run the same agent) that brings:

- the `venom` skill, which tells the agent when to read and log Venom work;
- hooks that add short Venom notes to what the model sees: Venom's guidance
  (and, once signed in, your Venom projects and unread mentions) before the
  first prompt, and one question before the agent finishes if a merge,
  release, workflow run, deploy or publish was never logged.

This folder is an [Agent Plugins](https://agent-plugins.org) 1.0 package named
`venom-full`: `plugin.json`, `skills/venom/SKILL.md` and
`dev.openhands/hooks/hooks.json` (OpenHands' own extension folder).

It carries no MCP server. Per OpenHands' source (SDK 1.63), a plugin's server
gets no OAuth sign-in, and it replaces a server of the same name that you
added and signed in to. So add the Venom server in OpenHands' MCP settings
instead (below).

## Install

1. **The server.** In Agent Canvas, open Settings, then MCP, choose
   **Add custom server**, then **SHTTP**: URL `https://mcp.venomlabs.dev`,
   name `venom`, Authentication **OAuth** (leave the client ID and secret
   empty). Approve the Venom sign-in that opens.
2. **The plugin**, one of:
   - Agent Canvas, Plugins: install from source `github:venomlabs-dev/venom-full`,
     path `openhands`.
   - A local backend: copy this folder to `~/.openhands/plugins/venom-full` on
     the machine the agent server runs on. OpenHands loads it into every new
     conversation.

     ```bash
     git clone --depth 1 https://github.com/venomlabs-dev/venom-full ~/.venom-full
     mkdir -p ~/.openhands/plugins
     cp -R ~/.venom-full/openhands ~/.openhands/plugins/venom-full
     ```

   - SDK scripts: `install_plugin("github:venomlabs-dev/venom-full",
     repo_path="openhands")` from `openhands.sdk.plugin`, or
     `PluginSource(source="github:venomlabs-dev/venom-full", repo_path="openhands")`
     in `Conversation(plugins=[...])`.
   - OpenHands Cloud: a launch link with
     `[{"source":"github:venomlabs-dev/venom-full","ref":"main","repo_path":"openhands"}]`
     as its base64 `plugins` value.
3. Optional, for your projects and mentions at session start: sign the hooks
   in once per machine with the plugin's own script, `sh <plugin
   folder>/hooks/venom-hook.sh login` (for the copy above,
   `sh ~/.openhands/plugins/venom-full/hooks/venom-hook.sh login`; from a
   clone, `sh ~/.venom-full/shared/venom-hook.sh login`). Signed out, the
   first conversation each day says how
   ([details](../README.md#sign-in-for-your-projects-and-mentions)).

Don't add the [`venom` plugin](https://github.com/venomlabs-dev/plugin)'s
Agent Plugins package in OpenHands: its server has no sign-in there.

Hooks need `sh`: macOS, Linux and WSL. Tested with the OpenHands SDK 1.63.1;
the hooks need `PLUGIN_ROOT` set for plugin hooks, which older versions may
not do.

## What each event adds

| OpenHands hook | Core event | What Venom adds |
| --- | --- | --- |
| `session_start` | `session-start` | `additionalContext`: find the Venom project and task, check mentions. OpenHands gives it to the agent before the first prompt. |
| `post_tool_use` (every tool) | `post-tool` | Notes a commit, push, PR, merge, release, issue close, workflow run, deploy or publish run in the terminal, for the stop question. A Venom `append_task_log`, `append_project_log` or `edit_log_entry` call clears it. |
| `stop` | `stop` | `{"decision":"deny","reason":...}`, asked once after a merge, release, workflow run, deploy or publish with no Venom log after it. OpenHands sends the reason to the agent, which keeps working. |

## Limits

- No reminder right after a commit or push: OpenHands doesn't pass
  `post_tool_use` output to the model. The wrapper still prints it, so it
  arrives if OpenHands starts passing it on.
- No compaction or subagent notes: OpenHands has no hooks for those.
- Goose installs plugins into `~/.agents/plugins`, which OpenHands also loads.
  With Goose's `venom` plugin installed on the same machine, OpenHands loads
  that too, and per OpenHands' source its `venom` server (no sign-in) replaces
  the one you added in step 1. Not run.
- Signed-in session starts need the sign-in file where the hooks run. An
  OpenHands Cloud sandbox has none and starts fresh, so each Cloud
  conversation gets the fixed texts plus the note on how to sign in.

## Verified

CI runs [test/live/run.sh](test/live/run.sh) on Linux with the OpenHands
Software Agent SDK 1.63.1 (`openhands-sdk`, `openhands-tools`,
`openhands-agent-server` from PyPI) against a stand-in model
([test/live/mock-model.mjs](../test/live/mock-model.mjs)). A conversation
that names no plugin, with this folder copied to `~/.openhands/plugins` and,
separately, installed with `install_plugin`: the `venom` skill loads and its
description reaches the model, the session-start text reaches the model, the
model's terminal call runs `git commit` and a stand-in `gh pr merge`, and the
stop question about the merge reaches the model. The agent server's MCP
OAuth route (what Agent Canvas's MCP settings call) adds a `venom` server
against a stand-in for Venom's sign-in ([test/live/mock-mcp.mjs](../test/live/mock-mcp.mjs))
and returns its sign-in link after registering. On pushes to main a job
installs from `github:venomlabs-dev/venom-full` with path `openhands`. First
passing run: 23 Nov 2026.

Not run: the Agent Canvas screens, OpenHands Cloud and its launch link,
`PluginSource`, a real model, and a real Venom sign-in. `node --test 'openhands/test/*.test.mjs'` runs the wrapper and
package tests.
