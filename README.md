# Venom Full

The full Venom experience for developers in Claude Code and Codex. It adds
hooks to the [`venom`](https://github.com/venomlabs-dev/plugin) plugin:

- **Each new session** starts with your Venom projects and unread mentions,
  so the agent knows where to look before it acts. They arrive with your
  first prompt.
- **After a milestone** (a commit, push, pull request, merge, release, closed
  issue, workflow run, deploy or publish) the agent is reminded to log the
  outcome. If the turn ends with nothing logged after it, Venom asks once
  more. The agent logs only if there's a decision, outcome, blocker or next
  step worth recording, so unfinished work isn't logged early.
- **Compaction and subagents**: guidance before and after compaction keeps
  the task in view, and subagents report to their parent instead of writing.
- **New mentions** from teammates show up on your next prompt.

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
