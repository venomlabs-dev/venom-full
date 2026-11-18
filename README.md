# Venom Full

The full Venom experience for developers. In Claude Code and Codex it adds
hooks to the [`venom`](https://github.com/venomlabs-dev/plugin) plugin.
OpenCode and Amp get their own plugin from this repository: see
[OpenCode](#opencode) and [Amp](#amp). Every other agent that has hooks gets
its own package in a folder of this repository: see
[Other agents](#other-agents).

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

## Other agents

These agents can't run the Claude Code and Codex hooks, which call Venom's
server. Each folder below holds a package in that agent's own format, built on
one shared script ([shared/venom-hook.sh](shared/venom-hook.sh)) and one set of
texts ([shared/guidance.json](shared/guidance.json)), the same texts the server
sends Claude Code and Codex. They add Venom's guidance at the start of a
session and, where the agent allows it, after compaction and in subagents; a
reminder to log after commits, pushes, pull requests, merges, releases,
deploys and publishes; and one question at the end of a turn when an outcome
wasn't logged. They don't show your projects and mentions yet: that needs a
signed-in client.

Install the `venom` plugin (server and skill) first, then the package for your
agent. Each folder's README has the details, what reaches the model, and how
it was checked.

| Agent | Folder | Install |
| --- | --- | --- |
| Cursor | [cursor](cursor) | Copy the folder to `~/.cursor/plugins/local/venom-full`; Cursor CLI: `--plugin-dir` |
| GitHub Copilot CLI and VS Code | [copilot](copilot) | `copilot plugin install venomlabs-dev/venom-full:copilot` |
| Gemini CLI | [gemini](gemini) | `gemini extensions install <clone>/gemini` |
| Antigravity | [antigravity](antigravity) | `agy plugin install <clone>/antigravity` |
| Grok Build | [grok](grok) | `grok plugin install venomlabs-dev/venom-full#grok --trust` |
| Qwen Code | [qwen](qwen) | `qwen extensions install <clone>/qwen` |
| Factory Droid | [droid](droid) | `droid plugin marketplace add venomlabs-dev/venom-full`, then `droid plugin install venom-droid@venom-full` |
| Devin CLI and Devin Desktop | [devin](devin) | `devin plugins install venomlabs-dev/venom-full#devin`, or the hooks file |
| JetBrains Junie | [junie](junie) | `/extensions marketplace add <clone>/junie`, then `/extensions install venom-junie` |
| Kiro | [kiro](kiro) | Copy the hook files into `~/.kiro/hooks/` |
| Augment (Auggie) | [auggie](auggie) | `auggie plugin marketplace add venomlabs-dev/venom-full`, then enable `venom-full` |
| Mistral Vibe | [vibe](vibe) | Copy the folder to `~/.vibe/plugins/venom-full` |
| Kimi Code | [kimi](kimi) | `/plugins install <clone>/kimi` |
| Muse Code | [muse](muse) | `muse plugins install <clone>/muse` |
| Pi | [pi](pi) | `pi install git:github.com/venomlabs-dev/venom-full` |
| OpenClaw | [openclaw](openclaw) | `openclaw plugins install <clone>/openclaw --accept-capabilities` |
| Hermes Agent | [hermes](hermes) | `hermes plugins install venomlabs-dev/venom-full/hermes --enable` |
| Cline | [cline](cline) | `sh <clone>/cline/install.sh` |
| Crush | [crush](crush) | `sh <clone>/crush/install.sh --apply` |
| Kilo Code | [opencode](opencode) | The OpenCode plugin runs in Kilo as is: `kilo plugin github:venomlabs-dev/venom-full` |

`<clone>` is a local clone of this repository
(`git clone https://github.com/venomlabs-dev/venom-full`).

To change a text, edit [shared/guidance.json](shared/guidance.json) and run
`npm run sync`, which updates every folder's copy; `npm test` fails if a copy
is out of date. Nothing in these folders reaches Claude Code or Codex
([test/guard.test.mjs](test/guard.test.mjs) checks it).

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

Install it from this repository. OpenCode 2.x:

```bash
opencode plugin add github:venomlabs-dev/venom-full
```

OpenCode 1.x:

```bash
opencode plugin -g github:venomlabs-dev/venom-full
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

If `amp plugins add` doesn't take the URL, save
[`amp/venom.ts`](amp/venom.ts) in `~/.config/amp/plugins/` instead, and copy
the plugin repository's `skills/venom` folder into `~/.config/agents/skills/`.

Amp signs in to Venom the first time it connects. If Amp asks before running
`venom.get_guidance`, allow it: the tool only reads Venom's guidance. The
plugin expects the server to be named `venom`.

Untested in Amp: the plugin is checked against Amp's published plugin types
and unit tests, but hasn't run in a signed-in Amp, and these commands come from
Amp's docs.

## Tests

```bash
npm test
```

## License

MIT
