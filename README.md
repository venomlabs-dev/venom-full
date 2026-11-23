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
wasn't logged.

### Sign in for your projects and mentions

Sign in once per machine, and every agent's Venom hooks on it start each
session with your Venom projects and unread mentions, like Claude Code does:

```bash
sh ~/.venom-full/shared/venom-hook.sh login
```

(From any clone or installed package folder, `sh <folder>/hooks/venom-hook.sh login`
does the same.)

It prints a link. Open it, sign in to Venom if you need to, check that the code
matches, pick the organization and approve. Your agent can run the command for
you and show you the link. `status` shows who is signed in, and `logout` signs
out. You can also disconnect "Venom hooks on <machine>" under Settings → Agent
connection in Venom.

- **What it can do:** only fetch that start-of-session list. It can't read or
  change your tasks.
- **Where it's kept:** `~/.config/venom/hooks-token` (or
  `$XDG_CONFIG_HOME/venom`), readable only by you. Never the system keychain.
- **When it can't reach Venom** (signed out, offline, or no answer within 3
  seconds), the hooks use their fixed texts, as before. While signed out, the
  agent hears how to sign in at most once a day.

Install the `venom` plugin (server and skill) first, then the package for your
agent (except Kimi, OpenClaw, Copilot and Auggie, whose one plugin has both,
and OpenHands, whose plugin has the skill and the hooks while the server goes
in OpenHands' MCP settings). Most shell-hook packages are named `venom-hooks`;
Copilot's, Auggie's and OpenHands' are `venom-full`, since they are the whole
of Venom there; the code plugins for
Pi, Hermes and Cline's CLI keep their own names. Each folder's README has the details, what reaches the model, and how
it was checked.

| Agent | Folder | Install |
| --- | --- | --- |
| Cursor | [cursor](cursor) | `cp -R <clone>/cursor ~/.cursor/plugins/local/venom-hooks`; Cursor CLI: `cursor-agent --plugin-dir <clone>/cursor` |
| GitHub Copilot CLI and VS Code | [copilot](copilot) | `copilot plugin install <clone>/copilot` (`copilot plugin install venomlabs-dev/venom-full:copilot` is untested) |
| Gemini CLI | [gemini](gemini) | `gemini extensions install <clone>/gemini` |
| Antigravity | [antigravity](antigravity) | `agy plugin install <clone>/antigravity` (the GitHub `tree/main/antigravity` URL is untested) |
| Grok Build | [grok](grok) | `grok plugin install <clone>/grok --trust` (`venomlabs-dev/venom-full#grok` is untested) |
| Qwen Code | [qwen](qwen) | `qwen extensions install <clone>/qwen` |
| Factory Droid | [droid](droid) | `droid plugin marketplace add venomlabs-dev/venom-full`, then `droid plugin install venom-hooks@venom-full` |
| Devin CLI and Devin Desktop | [devin](devin) | Installed with the [`venom`](https://github.com/venomlabs-dev/plugin) plugin: `devin plugins install venomlabs-dev/plugin`. Live in Devin CLI 3000.14, signed in: session start with projects and mentions, commit milestone. Without plugins: `cp <clone>/devin/hooks.v1.json .devin/hooks.v1.json` |
| JetBrains Junie | [junie](junie) | `/extensions marketplace add <clone>/junie`, then `/extensions install venom-hooks` (Junie itself was not run) |
| Kiro | [kiro](kiro) | Copy the hook files from `<clone>/kiro/hooks/` into `~/.kiro/hooks/` (see the folder README) |
| Augment (Auggie) | [auggie](auggie) | Venom Full in one plugin: `auggie plugin marketplace add venomlabs-dev/venom-full`, then enable `venom-full` in `/plugins` (server, skill, rule and hooks). `auggie install <clone>/auggie` adds the session-start, subagent and compaction notes (the extension). Loads in Auggie 1.2.2; not run with a model |
| OpenHands (Agent Canvas, OpenHands Cloud, SDK) | [openhands](openhands) | Agent Canvas, Plugins: install from source `github:venomlabs-dev/venom-full`, path `openhands`; or `cp -R <clone>/openhands ~/.openhands/plugins/venom-full`. Skill and hooks; add the server in Settings → MCP with OAuth (folder README). Live in CI with the OpenHands SDK 1.63.1 and a stand-in model |
| Mistral Vibe | [vibe](vibe) | Copy the folder to `~/.vibe/plugins/venom-hooks`, then sign in with `/mcp login` as its README says |
| Kimi Code | [kimi](kimi) | `/plugins install <clone>/kimi`. This one plugin replaces the `venom` plugin in Kimi (server, skill and hooks): don't install both |
| Muse Code | [muse](muse) | `muse plugins install <clone>/muse`, then `muse plugins approve venom-hooks` (not verified in Muse) |
| Pi | [pi](pi) | `pi install <clone>/pi` (checked); `pi install git:github.com/venomlabs-dev/venom-full` (untested) |
| OpenClaw | [openclaw](openclaw) | `openclaw plugins install <clone>/openclaw --accept-capabilities`. Ships the server and skill too |
| Hermes Agent | [hermes](hermes) | `hermes plugins install <clone>/hermes --enable`; the `venomlabs-dev/venom-full/hermes` form is from Hermes's docs, untested |
| Cline | [cline](cline) | `sh <clone>/cline/install.sh` (stops rather than overwrite hook files you already have), plus the CLI plugin in [cline](cline) |
| Crush | [crush](crush) | `sh <clone>/crush/install.sh --apply`. Start-up and milestone reminders only: Crush can't ask at the end of a turn |
| Kilo Code | [opencode](opencode) | The OpenCode plugin: `kilo plugin github:venomlabs-dev/venom-full`. In Kilo the model received its milestone note (earlier, milestones-only version); the newer session-start and end-of-turn parts are unit-tested only |

Goose has no package here: its hooks can't add text the model sees. Venom in
Goose is the `venom` plugin (the skill) plus the Venom extension link (the
server), both in the [plugin README](https://github.com/venomlabs-dev/plugin#apps-that-read-claude-plugins);
[test/live/goose.sh](test/live/goose.sh) checks both in Goose 1.60.2 in CI.

`<clone>` is a local clone of this repository. Venom's setup and its install
offer use `~/.venom-full`
(`git clone --depth 1 https://github.com/venomlabs-dev/venom-full ~/.venom-full`;
`git -C ~/.venom-full pull` updates it). Keep the clone: Crush's hooks run from it, and
updates come from it.

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
