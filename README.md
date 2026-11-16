# Venom Full

The full Venom experience for developers in Claude Code, Codex, OpenCode and
Amp. In Claude Code and Codex it adds hooks to the
[`venom`](https://github.com/venomlabs-dev/plugin) plugin. OpenCode and Amp
get their own plugin from this repository: see [OpenCode](#opencode) and
[Amp](#amp).

What the hooks do:

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

In Claude Code and Codex this plugin has no MCP server, skill or code of its
own. It ships `mcp_tool` hooks that call the Venom server's `get_guidance`
tool through the `venom` plugin's connection, so there's one sign-in and one
set of Venom tools. The wording comes from the server and changes without a
plugin update. While the hooks are active, the server stops adding reminder
lines to Venom tool responses. If Venom isn't connected, the hooks do nothing.

The `opencode/` and `amp/` folders hold the OpenCode and Amp plugins. Claude
Code and Codex ignore them.

## OpenCode

[`opencode/`](opencode) is one plugin for OpenCode 2.x and 1.x (1.18.29 or
later). It adds:

- the Venom MCP server (`https://mcp.venomlabs.dev`), unless you already
  configured one;
- the `venom` skill;
- before compaction, a note to keep the Venom task refs and unlogged
  decisions in the summary, and after it, a note to re-read the task;
- in subagent sessions, a note to report to the parent instead of writing;
- after a shell command that commits, pushes, opens or merges a pull request,
  releases, deploys or publishes, a reminder to log the outcome.

OpenCode plugins can't call an MCP tool, so the plugin carries these texts
itself ([`opencode/guidance.js`](opencode/guidance.js)), matched to the
server's. The server's instructions and tool-response reminders still reach
OpenCode.

Install it from this repository:

```bash
opencode plugin add github:venomlabs-dev/venom-full
```

Or add it to `opencode.json` yourself:

```json
{ "plugin": ["github:venomlabs-dev/venom-full"] }
```

OpenCode 2.x also reads the `plugins` key. Then sign in:

```bash
opencode mcp auth venom
```

## Amp

[`amp/venom.ts`](amp/venom.ts) gives Amp the same hooks as Claude Code. Amp
plugins can call MCP tools, so each event calls the Venom server's
`get_guidance`:

- each prompt: your projects and unread mentions on the first prompt of a
  thread, then new mentions;
- subagent threads: read Venom, report to the parent;
- after shell milestones: a reminder to log the outcome;
- end of turn: if a milestone came after the last Venom log, ask once more.

Amp has no compaction event, so nothing runs there.

Add the Venom server and the `venom` skill, then the plugin:

```bash
amp mcp add venom https://mcp.venomlabs.dev
amp skill add venomlabs-dev/plugin --global
amp plugins add https://raw.githubusercontent.com/venomlabs-dev/venom-full/main/amp/venom.ts
```

Amp signs in to Venom the first time it connects. If Amp asks before running
`venom.get_guidance`, allow it: the tool only reads Venom's guidance. The
plugin expects the server to be named `venom`.

The Amp plugin is checked against Amp's published plugin types and unit
tests, but hasn't run in a signed-in Amp yet.

## Tests

```bash
npm test
```

## License

MIT
