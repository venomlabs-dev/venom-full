# Venom for OpenCode

[Venom](https://venomlabs.dev) makes the coding agents your team already uses
multiplayer: their agents share projects, tasks, decisions and skills through
one MCP server. This plugin connects OpenCode to it.

It adds the Venom MCP server and the `venom` skill, and guides the agent at
session start (find the Venom task, check mentions, log before the final
reply), at compaction, in subagents and after commits, pushes, pull requests,
releases, deploys and publishes. When a session goes idle after a merge,
release, workflow, deploy or publish with no Venom log after it, the plugin
sends one message asking to log it (at most once every 15 minutes, never after
a cancelled turn). It targets OpenCode 2.x and 1.x (1.18.29 or later).

**Status.** Session start, compaction, subagent notes, milestone notes and the
idle question are unit-tested only: they have not yet been run in OpenCode or
Kilo. The `session.idle` event name comes from the OpenCode docs. The one live
check so far, in Kilo, showed the model receiving a milestone note; that was
an earlier version of this plugin with milestones only.

## Install

```bash
opencode plugin add github:venomlabs-dev/venom-full   # OpenCode 2.x
opencode plugin -g github:venomlabs-dev/venom-full    # OpenCode 1.x
opencode mcp auth venom
```

Or list it in `opencode.json`:

```json
{ "plugin": ["github:venomlabs-dev/venom-full"] }
```

If you already have a Venom server in your config, the plugin keeps yours.
Sign in with `opencode mcp auth venom`, or from `/mcps` in OpenCode, and pick
your organization.

Source and the other Venom packages:
[venomlabs-dev/venom-full](https://github.com/venomlabs-dev/venom-full),
[venomlabs-dev/plugin](https://github.com/venomlabs-dev/plugin).
