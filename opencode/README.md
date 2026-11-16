# Venom for OpenCode

[Venom](https://venomlabs.dev) makes the coding agents your team already uses
multiplayer: their agents share projects, tasks, decisions and skills through
one MCP server. This plugin connects OpenCode to it.

It adds the Venom MCP server and the `venom` skill, and guides the agent at
compaction, in subagents and after commits, pushes, pull requests, releases,
deploys and publishes. It works with OpenCode 2.x and 1.x (1.18.29 or later).

## Install

```bash
opencode plugin add github:venomlabs-dev/venom-full
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
