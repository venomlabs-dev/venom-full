# Venom hooks for Kiro (IDE and CLI)

Kiro Powers (the `venom` plugin) carry an MCP server and a skill but no hooks, so
Venom's reminders ship here as Kiro hook files. They add short Venom notes to the
agent's context at session start, around compaction, after a milestone (commit, push,
PR, merge, release, deploy, publish) and, once, at the end of a turn that merged,
released or deployed with nothing logged to Venom.

## Install Venom Full

Venom Full for Kiro is the `venom` Power plus these hooks. First install the
`venom` Power (Kiro: Powers panel, or `kiro-cli powers install`). Then copy
the hooks. For every project (user level, Kiro CLI V3):

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
Each command checks that its script exists and exits quietly (status 0) if not;
the project form also looks in the git root when Kiro's working directory is a
subfolder.

## What Kiro gets

| Kiro trigger | Core event | Adds |
|---|---|---|
| SessionStart | session-start | find the Venom project and task, check mentions |
| PreCompaction | pre-compact | keep task refs and unlogged decisions in the summary |
| PostCompaction | compacted | re-read the task, log decisions from before |
| PostToolUse (matcher `shell`) | post-tool | milestone reminder after commit, push, PR, merge, release, deploy, publish |
| PostToolUse (Venom log tools) | post-tool | clears the pending end-of-turn question |
| Stop | stop | asks once to log after merge, release, workflow, deploy or publish |

Output is plain stdout. Not verified: that Kiro adds a `Stop` or `PostToolUse` hook's stdout to the
agent's context (its docs only say exit-0 stdout is added; nothing was seen working).

## Limits

- No subagent event in Kiro, so no subagent reminder. Prompt Submit is not wired: its
  stdout reaching the model is not documented, and a Venom note per prompt would be noise.
- Your projects and unread mentions at session start come with the sign-in (`sh hooks/venom-hook.sh login` in this folder's installed copy; see [Sign in](../README.md#sign-in-for-your-projects-and-mentions)). Built and unit-tested; not yet seen in a live session of this agent.
- User-level `~/.kiro/hooks` is documented for CLI V3 only; the IDE reads `.kiro/hooks` in the workspace.
- Not verified: how Kiro handles Stop and PostToolUse stdout; its docs say no more than "exit 0 adds stdout to context", and the trigger names `PreCompaction` and `PostCompaction` come from the trigger table. See Verified.

## Verified

- Hook file format, triggers and locations read from kiro.dev/docs/hooks (2026-11-18).
- `node --test kiro/test/kiro.test.mjs` runs each hook's own command, installed as above
  (workspace and user variants), with Kiro-shaped payloads (`hook_event_name`, `cwd`,
  `session_id`, `tool_name`, `tool_input.command`); asserts exact output.
- Kiro CLI 3.4.0 installs Powers (`kiro-cli powers install`), but chat needs sign-in, so the
  hooks were NOT run inside Kiro. Not verified: that Kiro loads these files, the exact
  `PreCompaction`/`PostCompaction` names, and that Stop output reaches the model.
