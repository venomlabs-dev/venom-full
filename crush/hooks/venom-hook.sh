#!/bin/sh
# Venom hooks for agents whose hooks run shell commands (Cursor, Copilot,
# Gemini CLI, Antigravity and others). It prints the Venom guidance for one
# event, as plain text on one line, or nothing. Each agent's wrapper puts that
# text in the agent's own reply format.
#
#   venom-hook.sh <event>   with the agent's hook JSON on stdin
#
# Events: session-start, pre-compact, compacted, subagent, post-tool, stop.
# post-tool notes milestones (commit, push, PR, merge, release, deploy...) in
# the shell command; stop asks once to log after an outcome-type milestone
# when no Venom log call followed it. Wrappers can pass what they parsed
# themselves in VENOM_HOOK_SESSION, VENOM_HOOK_COMMAND and VENOM_HOOK_TOOL;
# otherwise the script reads the usual keys from the JSON.
#
# This file is copied into every agent folder by scripts/sync-shared.mjs: edit
# shared/venom-hook.sh, never a copy. It never fails the agent: always exit 0.

event=${1:-}
input=$(cat 2>/dev/null) || input=""

# >>> texts: generated from shared/guidance.json by scripts/sync-shared.mjs
SESSION_START="Venom: before your first reply about the team's work, find the Venom project and task it belongs to (search with a few keywords, or list_projects and read_task) and check list_mentions. If it is new work to build or change something and no task matches, create one first. Before your final reply, log decisions, outcomes and next steps to that task."
PRE_COMPACT="In the summary, keep the Venom project and task refs being worked on, any decisions not yet logged to Venom, and unanswered Venom mentions."
COMPACTED="Venom: context was compacted. If you were working on a Venom task, re-read it with read_task before continuing. Log any decisions from before compaction that are not in Venom yet."
SUBAGENT="Venom: you are a subagent. Read Venom if it helps your assignment, but do not write to it. Put decisions, findings and blockers in your final report so your parent can log them. Exception: if your parent gave you a Venom task to own, log to that task."
MILESTONE="Venom milestone: {what}. If this advances a Venom task, log the outcome with evidence (commit or PR link) and the next step, and update the status if it changed. A commit, push or PR alone does not make a task done unless the task says so."
STOP="Venom: {what} this turn and nothing was logged to Venom after it. If it produced a decision, outcome, blocker or next step a teammate would need, log it to the Venom task now, with the commit, PR or deploy as evidence. If the work isn't at a point worth recording yet, don't log anything; just finish your reply."
WHAT_COMMIT="you committed"
WHAT_PUSH="you pushed"
WHAT_PR="you opened a pull request"
WHAT_MERGE="you merged a pull request"
WHAT_RELEASE="you created a release"
WHAT_ISSUE="you closed an issue"
WHAT_WORKFLOW="you started a GitHub workflow"
WHAT_DEPLOY="you deployed"
WHAT_PUBLISH="you published a package or image"
STOP_KINDS="merge release workflow deploy publish"
MILESTONE_GAP_MINUTES=5
STOP_GAP_MINUTES=15
# <<< texts

say() { [ -n "$1" ] && printf '%s\n' "$1"; exit 0; }

what_for() {
  case $1 in
    commit) printf '%s' "$WHAT_COMMIT" ;; push) printf '%s' "$WHAT_PUSH" ;;
    pr) printf '%s' "$WHAT_PR" ;; merge) printf '%s' "$WHAT_MERGE" ;;
    release) printf '%s' "$WHAT_RELEASE" ;; issue) printf '%s' "$WHAT_ISSUE" ;;
    workflow) printf '%s' "$WHAT_WORKFLOW" ;; deploy) printf '%s' "$WHAT_DEPLOY" ;;
    publish) printf '%s' "$WHAT_PUBLISH" ;; *) printf '%s' "you finished a step" ;;
  esac
}

fill() { printf '%s' "$1" | sed "s/{what}/$2/"; }

# The value of the first "key": "value" pair among the given keys, one line.
json_value() {
  printf '%s' "$input" | tr '\n' ' ' |
    grep -o -E "\"($1)\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n 1 |
    sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

case $event in
  session-start) say "$SESSION_START" ;;
  pre-compact) say "$PRE_COMPACT" ;;
  compacted) say "$COMPACTED" ;;
  subagent) say "$SUBAGENT" ;;
  post-tool | stop) ;;
  *) exit 0 ;;
esac

session=${VENOM_HOOK_SESSION:-$(json_value 'session_id|sessionId|conversation_id|conversationId|session')}
session=$(printf '%s' "${session:-ppid-$PPID}" | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
dir="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"
mkdir -p "$dir" 2>/dev/null || exit 0
pending="$dir/$session.pending"

# Recent: the file exists and was touched less than $2 minutes ago.
recent() { [ -f "$1" ] && [ -n "$(find "$1" -mmin "-$2" 2>/dev/null)" ]; }

if [ "$event" = stop ]; then
  case $input in *'"stop_hook_active": true'* | *'"stop_hook_active":true'* | *'"stopHookActive": true'* | *'"stopHookActive":true'*) exit 0 ;; esac
  [ -f "$pending" ] || exit 0
  kind=$(cat "$pending" 2>/dev/null)
  rm -f "$pending"
  recent "$dir/$session.stop" "$STOP_GAP_MINUTES" && exit 0
  touch "$dir/$session.stop"
  say "$(fill "$STOP" "$(what_for "$kind")")"
fi

# post-tool: a Venom log call clears the pending stop question.
tool=${VENOM_HOOK_TOOL:-$input}
case $tool in *append_task_log* | *append_project_log* | *edit_log_entry*) rm -f "$pending"; exit 0 ;; esac

command=${VENOM_HOOK_COMMAND:-$(json_value 'command|cmd')}
[ -n "$command" ] || exit 0
# Quoted strings are data (a commit message that says "git push" is not a
# push); JSON line breaks and && || ; | ( separate commands. Some agents (Go
# JSON, e.g. Crush) send & < > as & < >: decode those first.
command=$(printf '%s' "$command" | sed -E 's/\\u0026/\&/g; s/\\u003[cC]/</g; s/\\u003[eE]/>/g' |
  sed -E 's/\\"([^"\\]|\\[^"])*\\"//g; s/"[^"]*"//g; s/'"'"'[^'"'"']*'"'"'//g; s/\\n/;/g')
s='(^|[;&|(][[:space:]]*)'
g="${s}git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+"
e='([[:space:]]|[;&|)]|$)'
has() { printf '%s' "$command" | grep -q -E "$1"; }
kind=""
for k in merge release workflow deploy publish commit push pr issue; do
  case $k in
    commit) p="${g}commit$e" ;;
    push) p="${g}push$e" ;;
    pr) p="${s}gh[[:space:]]+pr[[:space:]]+create$e" ;;
    merge) p="${s}gh[[:space:]]+pr[[:space:]]+merge$e" ;;
    release) p="${s}gh[[:space:]]+release[[:space:]]+create$e" ;;
    issue) p="${s}gh[[:space:]]+issue[[:space:]]+close$e" ;;
    workflow) p="${s}gh[[:space:]]+workflow[[:space:]]+run$e" ;;
    deploy) p="${s}(npx[[:space:]]+)?((vercel|netlify|fly|flyctl|firebase|wrangler|cdk|serverless|sls)[[:space:]]+([^;&|]*[[:space:]])?deploy$e|vercel[[:space:]]+([^;&|]*[[:space:]])?--prod$e)|${s}(terraform[[:space:]]+apply|kubectl[[:space:]]+apply|helm[[:space:]]+upgrade)$e" ;;
    publish) p="${s}((npm|pnpm|yarn|cargo)[[:space:]]+publish|docker[[:space:]]+push|twine[[:space:]]+upload)$e" ;;
  esac
  if has "$p"; then kind=$k; break; fi
done
[ -n "$kind" ] || exit 0

case " $STOP_KINDS " in *" $kind "*) printf '%s' "$kind" > "$pending" ;; esac
recent "$dir/$session.m.$kind" "$MILESTONE_GAP_MINUTES" && exit 0
touch "$dir/$session.m.$kind"
find "$dir" -type f -mtime +1 -exec rm -f {} + 2>/dev/null
say "$(fill "$MILESTONE" "$(what_for "$kind")")"
