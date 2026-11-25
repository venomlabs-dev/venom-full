# Venom hooks for Qwen Code

An extension for [Qwen Code](https://github.com/QwenLM/qwen-code) that adds short Venom reminders to the agent's context at the right moments, so it checks Venom before work and logs outcomes after. It carries hooks only: the Venom MCP server and the `venom` skill come from the `venom` extension, which Venom Full for Qwen Code installs with this one.

## Install Venom Full

```bash
qwen extensions install venomlabs-dev/plugin
qwen extensions install <path to a clone of venomlabs-dev/venom-full>/qwen
```

`qwen extensions install` takes a git URL, local path, archive, npm package or marketplace entry; it has no option for a subfolder of a repository, so until a marketplace entry points at `qwen/` (see below), install from a local clone. Qwen Code asks you to confirm the install because the extension runs shell hooks.

## What it adds

| Qwen Code event | Venom event | Output |
| --- | --- | --- |
| SessionStart (startup, resume, clear) | session-start | `hookSpecificOutput.additionalContext` |
| SessionStart (compact) | compacted | `hookSpecificOutput.additionalContext` |
| PreCompact | pre-compact | `additionalContext`, which Qwen Code passes to the summarizer as extra instructions |
| SubagentStart | subagent | `additionalContext` |
| PostToolUse: `run_shell_command` | post-tool (commit, push, PR, merge, release, issue close, workflow, deploy, publish) | `additionalContext`, appended to the tool result |
| PostToolUse: Venom log tools (`append_task_log`, `append_project_log`, `edit_log_entry`) | post-tool (clears the pending stop question) | none |
| Stop | stop (asked once after merge, release, workflow, deploy or publish with no Venom log after it) | `{"decision":"block","reason":...}`, so the agent answers once more |

Not wired: UserPromptSubmit (the shared core has no event for it; your projects and mentions come at session start with the [sign-in](../README.md#sign-in-for-your-projects-and-mentions)), PostCompact (its output is ignored), SubagentStop, MessageDisplay and the rest.

## How it works

`qwen-extension.json` points to `hooks/qwen-hooks.json`. Qwen Code replaces `${CLAUDE_PLUGIN_ROOT}` in extension hook commands with the install folder. `hooks/venom-qwen.sh` runs the shared `hooks/venom-hook.sh` and wraps its one-line text in Qwen Code's JSON; it prints nothing when there is nothing to say. Edit `shared/` in the repository, never the copy (`node scripts/sync-shared.mjs qwen`).

## Verified

- Qwen Code 0.28.0 (npm `@qwen-code/qwen-code`), isolated HOME, no sign-in. `qwen extensions install <local qwen folder> --consent` installs it and `qwen extensions list` shows `venom-hooks` enabled; the installed copy holds the manifest and `hooks/`.
- Headless run (`qwen --auth-type openai --yolo -p`) against a local mock OpenAI-compatible server, inspecting the requests the model received: the session-start text arrived in the session context; after `git commit` and `gh pr merge` the milestone text was appended to the shell tool result; after the merge the turn ended with the Stop block and the stop text reached the model as a user message, once.
- `npm test` covers the wrapper with payloads shaped like Qwen Code's hook docs.

Not verified: SubagentStart (in the one live run the subagent's requests did not show the text; Qwen Code stores it as `hook_context`, and it may reach only some subagent prompts); SessionStart with source `compact` and PreCompact (read in Qwen Code's code, not triggered); a Venom log call clearing the stop question in a live run (the mock MCP tool was refused by Qwen's deferred-tool bridge; covered by the wrapper test); installing straight from GitHub. After the keychain rule came in, Qwen Code was not run again: its package can use the macOS keychain (optional keytar, for MCP OAuth tokens).

## Marketplace entry (for the plugin repository)

Qwen Code reads Claude Code marketplaces. An entry with `"source": {"source": "git-subdir", "url": "https://github.com/venomlabs-dev/venom-full", "path": "qwen"}` would let users run `qwen extensions install venomlabs-dev/plugin:venom-full-qwen`. Not tested.
