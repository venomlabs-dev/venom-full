# Venom hooks for Kiro (IDE and CLI)

Kiro Powers (the `venom` plugin) carry an MCP server and a skill but no hooks, so
Venom's reminders ship here as Kiro hook files. They add short Venom notes to the
agent's context at session start, around compaction, after a milestone (commit, push,
PR, merge, release, deploy, publish) and, once, at the end of a turn that merged,
released or deployed with nothing logged to Venom.

## Install

Install the `venom` Power first (Kiro: Powers panel, or `kiro-cli powers install`).
Then copy the hooks. For every project (user level, Kiro CLI V3):

```bash
git clone https://github.com/venomlabs-dev/venom-full && cd venom-full
mkdir -p ~/.kiro/hooks/venom
cp kiro/hooks/venom-hook.sh ~/.kiro/hooks/venom/
cp kiro/hooks/venom-user.json ~/.kiro/hooks/venom.json
```

For one project (IDE and CLI), from the project root:

```bash
mkdir -p .kiro/hooks/venom
cp /path/to/venom-full/kiro/hooks/venom-hook.sh .kiro/hooks/venom/
cp /path/to/venom-full/kiro/hooks/venom-workspace.json .kiro/hooks/venom.json
```

Restart the Kiro session. Hooks run with `sh`, so macOS, Linux and WSL work.

## What Kiro gets

| Kiro trigger | Core event | Adds |
|---|---|---|
| SessionStart | session-start | find the Venom project and task, check mentions |
| PreCompaction | pre-compact | keep task refs and unlogged decisions in the summary |
| PostCompaction | compacted | re-read the task, log decisions from before |
| PostToolUse (matcher `shell`) | post-tool | milestone reminder after commit, push, PR, merge, release, deploy, publish |
| PostToolUse (Venom log tools) | post-tool | clears the pending end-of-turn question |
| Stop | stop | asks once to log after merge, release, workflow, deploy or publish |

Output is plain stdout (Kiro adds exit-0 stdout to the agent's context).

## Limits

- No subagent event in Kiro, so no subagent reminder. Prompt Submit is not wired: its
  stdout reaching the model is not documented, and a Venom note per prompt would be noise.
- No projects/mentions list at session start (needs a signed-in client, planned later).
- User-level `~/.kiro/hooks` is documented for CLI V3 only; the IDE reads `.kiro/hooks` in the workspace.
- Kiro does not document how Stop and PostToolUse stdout is handled beyond "exit 0 adds stdout to context", and the trigger names `PreCompaction` and `PostCompaction` come from the trigger table. See Verified.

## Verified

- Hook file format, triggers and locations read from kiro.dev/docs/hooks (2026-11-18).
- `node --test kiro/test/kiro.test.mjs` runs each hook's own command, installed as above
  (workspace and user variants), with Kiro-shaped payloads (`hook_event_name`, `cwd`,
  `session_id`, `tool_name`, `tool_input.command`); asserts exact output.
- Kiro CLI 3.4.0 installs Powers (`kiro-cli powers install`), but chat needs sign-in, so the
  hooks were NOT run inside Kiro. Not verified: that Kiro loads these files, the exact
  `PreCompaction`/`PostCompaction` names, and that Stop output reaches the model.
