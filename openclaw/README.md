# Venom for OpenClaw

[Venom](https://venomlabs.dev) makes the coding agents your team already uses
multiplayer: their agents share projects, tasks, decisions and skills through
one MCP server. This native OpenClaw plugin connects OpenClaw to it. It adds the
Venom MCP server and the `venom` skill, and reminds the agent about Venom at
session start, after compaction, in subagents and after commits, pushes, pull
requests, merges, releases, deploys and publishes. One plugin, so you do not
need the separate `venom` plugin on OpenClaw.

## Install

From the npm package (once published):

```bash
openclaw plugins install npm:@venomlabs/openclaw
```

From a clone of [venom-full](https://github.com/venomlabs-dev/venom-full)
(OpenClaw's `git:` installs need the plugin at the repository root, so use the folder):

```bash
git clone https://github.com/venomlabs-dev/venom-full
openclaw plugins install ./venom-full/openclaw --accept-capabilities
```

Then, for the "log it before you finish" question after a merge, release or deploy:

```bash
openclaw config set plugins.entries.venom.hooks.allowConversationAccess true
```

Sign in to the `venom` MCP server when OpenClaw asks. If you already have a
`venom` entry under `mcp.servers`, yours wins.

## What it adds

| OpenClaw event | What the agent gets |
| --- | --- |
| `session_start` | Session start text, queued with `enqueueNextTurnInjection` for the first turn |
| `subagent_spawned` | Subagent text queued for the child session (it never gets the session start text) |
| `after_compaction` | Re-read the Venom task text, steered into the active run (else next turn) |
| `after_tool_call` on `exec` | Milestone text after commit, push, PR, merge, release, deploy, publish (at most once per type per 5 minutes per session), steered into the run (else next turn); a Venom log tool clears the pending stop question |
| `before_agent_finalize` | After a merge, release, workflow, deploy or publish with no Venom log since, one more pass to log it (`action: "revise"`), once |

The texts and limits are shared with the other Venom packages
(`guidance.json`, from `shared/guidance.json`).

## Limits

- Without `allowConversationAccess` the plugin works except the stop question
  (OpenClaw only allows `before_agent_finalize` for plugins with that grant).
- No pre-compaction text: `before_compaction` cannot change the summary.
- Your projects and unread mentions at session start come with the sign-in (`sh hooks/venom-hook.sh login` in this folder's installed copy; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Built and unit-tested; not yet seen in a live session of this agent.
- Venom reminders reach every OpenClaw session, including chat channels.
- `after_tool_call` is observe-only, so milestone text is steered into the run
  with `steerActiveRun`; that and the injection API are documented but
  experimental in OpenClaw's plugin API.

## Verified

Against the OpenClaw 2026.11.5 docs and type definitions: the 10 tests in
`test/openclaw.test.mjs` run the plugin on a fake api shaped like OpenClaw's
(`node --test openclaw/test/openclaw.test.mjs`). OpenClaw itself refused the
local install pending `--accept-capabilities` (capability consent, since the
plugin declares an MCP server). Not run in OpenClaw: the OpenClaw CLI reads
credential stores that may include the macOS keychain, so no further runs were
made, and no live model turn was attempted.
