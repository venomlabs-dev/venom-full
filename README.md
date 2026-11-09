# Venom Full

The full Venom experience for developers in Claude Code and Codex. It adds
hooks to the [`venom`](https://github.com/venomlabs-dev/plugin) plugin, so
your agent gets Venom guidance after compaction, before compaction (Claude
Code), when a subagent starts, on each prompt, and after `git commit`,
`git push`, `gh pr create` and `gh pr merge`.

Anthropic's and OpenAI's plugin directories don't accept hooks from us, so
Venom Full isn't listed there. It installs from the Venom marketplace, the
same one as `venom`.

## Install

Claude Code (installs `venom` too):

```text
/plugin marketplace add venomlabs-dev/plugin
/plugin install venom-full@venom
```

Codex:

```bash
codex plugin marketplace add venomlabs-dev/plugin
codex plugin add venom@venom
codex plugin add venom-full@venom
```

Then trust the Venom hooks once in `/hooks`.

## How it works

This plugin has no MCP server, skill or code of its own. It ships `mcp_tool`
hooks that call the Venom server's `get_guidance` tool through the `venom`
plugin's connection, so there's one sign-in and one set of Venom tools. The
wording comes from the server and changes without a plugin update. While the
hooks are active, the server stops adding reminder lines to Venom tool
responses. If Venom isn't connected, the hooks do nothing.

## License

MIT
