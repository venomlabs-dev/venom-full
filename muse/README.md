# Venom hooks for Muse Code

Adds short Venom reminders to Muse Code's context at the right moments: find the
Venom task when a session starts, log the outcome after a commit, push, PR,
merge, release, deploy or publish, keep the task in view across compaction, and
tell subagents to report to their parent. It is a native Muse plugin
(`.muse-plugin/plugin.json`) that carries only command hooks. The Venom server and
the `venom` skill come from the `venom` plugin, which Venom Full for Muse
Code installs with this one.

**Not verified anywhere in Muse: nothing here has run inside Muse Code.** The
manifest shape, the hook commands, the reply fields and that Muse loads and
runs the hooks all come from docs and binary strings (see Verification).
Each hook command checks that its script exists (relative to the plugin
folder) and exits quietly if not.

## Install Venom Full

```bash
git clone https://github.com/venomlabs-dev/venom-full
muse plugins install ./venom-full/muse
muse plugins approve venom-hooks
```

(`muse plugins install` takes a local path or `<plugin>@<marketplace>`; it has no
GitHub subfolder source, so clone first.) Also install `venom` (before or after):
`muse plugins install <path to venomlabs-dev/plugin>/platforms/agent-plugin`.
Start a new session: Muse reads hooks at startup. `muse plugins inspect venom-hooks`
lists the registered hooks.

## What it adds

| Muse event | Venom core event | Reply field |
| --- | --- | --- |
| SessionStart | session-start (find the project and task, check mentions) | `hookSpecificOutput.additionalContext` |
| PreCompact | pre-compact (keep task refs in the summary) | `hookSpecificOutput.additionalContext` |
| PostCompact | compacted (re-read the task) | `hookSpecificOutput.additionalContext` |
| SubagentStart | subagent (report to the parent, don't write) | `hookSpecificOutput.additionalContext` |
| PostToolUse (all tools) | post-tool (milestone reminder after a shell command; a Venom log call clears the pending stop question) | `hookSpecificOutput.additionalContext` |
| Stop | stop (asked once after merge, release, workflow, deploy or publish with nothing logged) | `decision: block` + `reason` |

Skipped: UserPromptSubmit, PreToolUse, PostToolBatch, PreLLMCall, PostLLMCall,
SessionEnd (nothing the core says belongs there; SessionEnd cannot add context).
PostToolUse has no matcher because Muse's shell tool name is not documented; the
core ignores every call that is not a milestone command or a Venom log call.

## Limits

- No projects or unread mentions list at session start: that needs a signed-in
  client (planned).
- Hooks run outside Muse's sandbox, so Muse asks you to approve them once.
- The Stop reply uses `decision: block`, which makes Muse continue the turn with
  the reason; Muse caps consecutive Stop continuations.

## Verification

Muse Code 1.4.23 (macOS arm64). Muse's own docs (dev.meta.ai/docs/muse-code/extending)
list the events and the hook sources but not the plugin hook schema or reply
fields. The manifest shape comes from Muse's bundled `create-plugin` skill
reference; the reply field names (`hookSpecificOutput.hookEventName` and
`additionalContext`, `decision` and `reason`) and payload keys come from strings in
the 1.4.23 binary. `node --test` runs the wrappers with Muse-style payloads
(`muse/test/muse.test.mjs`). The Muse binary was NOT run against this package:
it reads the macOS keychain at startup, so `muse plugins validate`, `install`,
`hook test` and a live turn are still to do on a signed-in machine.
