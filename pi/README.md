# Venom hooks for Pi

[Venom](https://venomlabs.dev) makes the coding agents your team already uses
multiplayer. The `venom` plugin gives Pi the Venom skill and MCP server; this
extension makes Pi remember to use them. It adds short Venom reminders to what
the model sees at the start of a session, after commits, pushes, pull requests,
merges, releases, deploys and publishes, after compaction, and once before Pi
finishes a turn that merged or shipped something without logging it to Venom.
It is one JavaScript file that Pi loads as it is (no build step).

## Install

```bash
pi install git:github.com/venomlabs-dev/plugin          # the Venom skill, first
git clone https://github.com/venomlabs-dev/venom-full
pi install ./venom-full/pi                              # these hooks
pi mcp add venom --url https://mcp.venomlabs.dev        # the Venom server, then /mcp login venom
```

`pi install` cannot take a subfolder of a git repository, so the clone-path
install above is the one that was verified. The root `package.json` of
venom-full now carries `"pi": { "extensions": ["./pi/extensions/venom.js"] }`,
so `pi install git:github.com/venomlabs-dev/venom-full` should work too, but
that form was never run: untested.

## What it adds

| Pi event | Venom adds |
|---|---|
| `before_agent_start` (first prompt of a new session) | Find the Venom project and task, check mentions, log before the final reply (a hidden message) |
| `tool_result` of `bash` (commit, push, PR, merge, release, issue close, workflow, deploy, publish) | The milestone note, appended to the shell output; once per kind every 5 minutes |
| `session_compact` | The re-read-the-task note, queued for the next prompt |
| `agent_before_settle` | After merge, release, workflow, deploy or publish with no Venom log call since (and not older than 60 minutes): one more turn with the stop question, at most once per 15 minutes |
| `tool_result` of `append_task_log`, `append_project_log`, `edit_log_entry` | Clears the pending stop question |

Texts come from `guidance.json`, the same as every Venom agent package.

## Limits

- No subagent text: Pi has no built-in subagents (extensions start a separate
  `pi` process), so there is nothing to detect.
- No pre-compaction text: Pi's `session_before_compact` can only replace the
  summary or cancel, not add to it.
- No project or mention lists yet; that needs a signed-in client.
- State is kept in memory for the Pi process.

## Verified

Pi 1.5.2, isolated HOME, a local mock OpenAI-compatible model (no sign-in):
`pi install` from the local folder registers the package (`pi list`); a headless
`pi -p` run showed the model receiving the session-start message, the milestone
note inside the bash tool result, and the stop question once as an extra turn.
Compaction and the `/mcp` flow were not run. Tests: `node --test pi/test/pi.test.mjs`.
