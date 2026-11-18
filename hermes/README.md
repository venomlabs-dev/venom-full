# Venom for Hermes Agent

This Hermes plugin adds short Venom reminders to the model's context at the right moments, so the agent finds its Venom task before it starts, logs what it decided, and does not forget Venom after a commit, a merge or a deploy. It needs Venom's MCP server and `venom` skill first: Hermes refuses the `venomlabs-dev/plugin` repository as a plugin, so install the skill with `hermes skills install https://raw.githubusercontent.com/venomlabs-dev/plugin/main/skills/venom/SKILL.md` and add `venom` with `url: https://mcp.venomlabs.dev` and `auth: oauth` under `mcp_servers` in `~/.hermes/config.yaml`. This plugin only adds the reminders.

## Install

From a local clone:

```sh
git clone https://github.com/venomlabs-dev/venom-full
hermes plugins install ./venom-full/hermes --enable
```

Hermes's docs also allow a GitHub subfolder (not tried yet):

```sh
hermes plugins install venomlabs-dev/venom-full/hermes --enable
```

Check it: `hermes plugins list` shows `venom` as enabled.

## What it adds

| Hermes hook | What Venom adds |
|---|---|
| `pre_llm_call`, first turn of a session | Find the Venom project and task, check mentions, log before the final reply |
| `pre_llm_call`, a subagent's first turn | Read Venom if useful, do not write; put findings in the final report |
| `post_compaction` then `pre_llm_call` | After a compaction: re-read the task with `read_task`, log decisions not yet in Venom |
| `post_tool_call` and `transform_tool_result` after a shell command | A note after a commit, push, pull request, merge, release, closed issue, workflow run, deploy or publish: log the outcome with evidence. Said once per type every 5 minutes. Failed commands are skipped |
| `pre_verify` | Asks once to log (the question survives new turns, and is dropped after 60 minutes), after a merge, release, workflow run, deploy or publish with no Venom log call after it |
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

## Verified

- Unit-tested: 16 Python tests (`python3 -m unittest discover hermes/test`), including the milestone rules (env prefixes, `sudo`, `then`, `{`, `gh -R`, dry run, help, heredoc) and the 60-minute expiry of the stop question.
- Hermes's own install scanner returns SAFE for this plugin.
- Never installed or run in Hermes. The `hermes plugins install venomlabs-dev/venom-full/hermes` subfolder form comes from Hermes's docs and was not tried.
