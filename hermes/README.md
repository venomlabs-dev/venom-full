# Venom for Hermes Agent

This Hermes plugin adds short Venom reminders to the model's context at the right moments, so the agent finds its Venom task before it starts, logs what it decided, and does not forget Venom after a commit, a merge or a deploy. It needs the `venom` plugin or MCP server from `venomlabs-dev/plugin` installed first. This plugin only adds the reminders.

## Install

```sh
hermes plugins install venomlabs-dev/venom-full/hermes --enable
```

From a local clone:

```sh
hermes plugins install /path/to/venom-full/hermes --enable
```

Check it: `hermes plugins list` shows `venom` as enabled.

## What it adds

| Hermes hook | What Venom adds |
|---|---|
| `pre_llm_call`, first turn of a session | Find the Venom project and task, check mentions, log before the final reply |
| `pre_llm_call`, a subagent's first turn | Read Venom if useful, do not write; put findings in the final report |
| `post_compaction` then `pre_llm_call` | After a compaction: re-read the task with `read_task`, log decisions not yet in Venom |
| `post_tool_call` and `transform_tool_result` after a shell command | A note after a commit, push, pull request, merge, release, closed issue, workflow run, deploy or publish: log the outcome with evidence. Said once per type every 5 minutes. Failed commands are skipped |
| `pre_verify` | Asks once to log, after a merge, release, workflow run, deploy or publish with no Venom log call after it |
| `post_tool_call` on `append_task_log`, `append_project_log`, `edit_log_entry` | Clears the pending question |

The texts live in `guidance.json`, shared with the other Venom agent packages.

## Limits

- Hermes has no hook before a compaction, so the keep-these-refs text for the summary is not sent. The after-compaction text is.
- `pre_verify` runs only on turns where the agent edited code, so the finish question is asked only then.
- There is no list of projects or mentions yet; that needs a signed-in client and is planned for later.
- State is kept in memory for the Hermes process.

## Tests

```sh
python3 -m unittest discover hermes/test
node --test 'hermes/test/*.test.mjs'
```
