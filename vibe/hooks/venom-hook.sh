#!/bin/sh
# Venom hooks for agents whose hooks run shell commands (Cursor, Copilot,
# Gemini CLI, Antigravity and others). It prints the Venom guidance for one
# event, as plain text on one line, or nothing. Each agent's wrapper puts that
# text in the agent's own reply format.
#
#   venom-hook.sh <event>   with the agent's hook JSON on stdin
#   venom-hook.sh login | status | logout
#
# Events: session-start, pre-compact, compacted, subagent, post-tool, stop.
# session-extra prints only what the sign-in adds at session start, for
# plugins that print their own session-start text.
# post-tool notes milestones (commit, push, PR, merge, release, deploy...) in
# the shell command; stop asks once to log after an outcome-type milestone
# when no Venom log call followed it. Wrappers can pass what they parsed
# themselves in VENOM_HOOK_SESSION, VENOM_HOOK_COMMAND and VENOM_HOOK_TOOL;
# otherwise the script reads the usual keys from the JSON.
#
# Signed in (login, once per machine), session start also brings the person's
# Venom projects and unread mentions from the Venom server. The sign-in is one
# file only this user can read, shared by every agent's hooks on the machine,
# never the system keychain. Signed out, offline or slow (3 seconds at most),
# the hooks print their fixed texts. The text comes out escaped for a JSON
# string, on one line; VENOM_HOOK_FORMAT=text prints it as it is.
#
# This file is copied into every agent folder by scripts/sync-shared.mjs: edit
# shared/venom-hook.sh, never a copy. It never fails the agent: always exit 0.

event=${1:-}

# >>> texts: generated from shared/guidance.json by scripts/sync-shared.mjs
SESSION_START="Venom: before your first reply about the team's work, find the Venom project and task it belongs to (search with a few keywords, or list_projects and read_task) and check list_mentions. If it is new work to build or change something and no task matches, create one first. Before your final reply, log decisions, outcomes and next steps to that task."
PRE_COMPACT="In the summary, keep the Venom project and task refs being worked on, any decisions not yet logged to Venom, and unanswered Venom mentions."
COMPACTED="Venom: context was compacted. If you were working on a Venom task, re-read it with read_task before continuing. Log any decisions from before compaction that are not in Venom yet."
SUBAGENT="Venom: you are a subagent. Read Venom if it helps your assignment, but do not write to it. Put decisions, findings and blockers in your final report so your parent can log them. Exception: if your parent gave you a Venom task to own, log to that task."
MILESTONE="Venom milestone: {what}. If this moves a Venom task, log it once for the whole ship, not per step: the outcome, its link and the next step. Set done only when the task's own check is met."
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
AGENT="vibe"
# <<< texts

# The text escaped for a JSON string: quotes, backslashes and line breaks.
json_escape() {
  printf '%s' "$1" | LC_ALL=C tr '\t' ' ' | LC_ALL=C tr -d '\000-\010\013-\037' |
    LC_ALL=C sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' |
    LC_ALL=C awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }'
}

# Valid UTF-8 only: a byte sequence cut short is dropped, not passed on.
utf8() { if command -v iconv >/dev/null 2>&1; then iconv -c -f UTF-8 -t UTF-8 2>/dev/null; else cat; fi; }

say() {
  [ -n "$1" ] || exit 0
  if [ "${VENOM_HOOK_FORMAT:-json}" = text ]; then printf '%s\n' "$1"; else json_escape "$1" && printf '\n'; fi
  exit 0
}

# --- Sign-in ----------------------------------------------------------------
SERVER=${VENOM_HOOK_SERVER:-https://mcp.venomlabs.dev}
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || here=.
self="$here/$(basename "$0")"
if [ -n "${VENOM_HOOK_CONFIG:-}" ]; then conf=$VENOM_HOOK_CONFIG
elif [ -n "${XDG_CONFIG_HOME:-}" ]; then conf="$XDG_CONFIG_HOME/venom"
elif [ -n "${HOME:-}" ]; then conf="$HOME/.config/venom"
else conf=""; fi
token_file="$conf/hooks-token"
login_file="$conf/hooks-login"

# Ours: owned by this user, and not a link someone else planted.
mine() { [ ! -L "$1" ] && [ -O "$1" ]; }
private_conf() {
  [ -n "$conf" ] || return 1
  (umask 077 && mkdir -p "$conf") 2>/dev/null
  [ -d "$conf" ] && mine "$conf" && chmod 700 "$conf" 2>/dev/null
}
setting() { sed -n "s/^$1=//p" "$token_file" 2>/dev/null | head -n 1; }
signed_in() { [ -n "$conf" ] && [ -f "$token_file" ] && mine "$conf" && mine "$token_file" && [ -n "$(setting token)" ]; }

# A string or number field of one of the Venom server's JSON replies.
field() {
  printf '%s' "$2" | tr '\n' ' ' |
    grep -o -E "\"$1\"[[:space:]]*:[[:space:]]*(\"([^\"\\\\]|\\\\.)*\"|[0-9]+)" | head -n 1 |
    sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*//; s/^"//; s/"$//'
}

# The token goes to curl as a config on stdin (-K -, which every curl reads),
# never on a command line others can see.
auth() { printf 'header = "Authorization: Bearer %s"\n' "$1"; }

# End one sign-in on the server; best effort.
revoke_token() {
  if [ -n "$1" ] && command -v curl >/dev/null 2>&1; then
    auth "$1" | curl -s -K - -X POST --connect-timeout 2 --max-time 5 "${2:-$SERVER}/hooks/v1/revoke" >/dev/null 2>&1
  fi
  return 0
}
revoke() { revoke_token "$(setting token)" "$(setting server)"; rm -f "$token_file"; }

# A whole number from the server between 1 and 3600, else the default.
number() {
  case $1 in '' | *[!0-9]*) printf '%s' "$2"; return ;; esac
  if [ "$1" -ge 1 ] && [ "$1" -le 3600 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi
}

# A sign-in started in the last 15 minutes and not finished yet.
login_pending() { [ -n "$conf" ] && [ -f "$login_file" ] && mine "$login_file" && [ -n "$(find "$login_file" -mmin -15 2>/dev/null)" ]; }
end_login() { rm -f "$login_file" "$login_file.server"; }

# Ask once whether the sign-in in progress was approved. 0: signed in (it
# prints so); 1: still waiting; 2: asked to slow down; 3: over without a
# sign-in (it prints why). $1 caps the wait in seconds.
poll_login() {
  lserver=$(cat "$login_file.server" 2>/dev/null)
  reply=$(curl -s --connect-timeout 5 --max-time "${1:-15}" \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    --data-urlencode "device_code@$login_file" "${lserver:-$SERVER}/hooks/v1/token" 2>/dev/null) || return 1
  token=$(field access_token "$reply")
  if [ -n "$token" ]; then
    org=$(field organization "$reply" | tr -d '\r\n=')
    old_token=$(setting token) old_server=$(setting server)
    tmp="$token_file.tmp.$$"
    (umask 077 && printf 'token=%s\nserver=%s\norganization=%s\n' "$token" "${lserver:-$SERVER}" "$org" > "$tmp") 2>/dev/null &&
      mv -f "$tmp" "$token_file" 2>/dev/null
    rm -f "$tmp"
    end_login
    if ! signed_in; then
      echo "Venom hooks: the sign-in could not be saved in $conf."
      return 3
    fi
    # The sign-in this one replaces ends only now that the new one works.
    [ -n "$old_token" ] && [ "$old_token" != "$token" ] && revoke_token "$old_token" "$old_server"
    printf 'Signed in%s. Agents on this machine now see your Venom projects and unread mentions when a session starts.\n' "${org:+ to $org}"
    return 0
  fi
  case $(field error "$reply") in
    authorization_pending | temporarily_unavailable | "") return 1 ;;
    slow_down) return 2 ;;
    access_denied) end_login; echo "Venom hooks: the sign-in was turned down."; return 3 ;;
    *) end_login; echo "Venom hooks: the sign-in code expired. Run login again."; return 3 ;;
  esac
}

wait_login() {
  interval=$(number "$1" 5) left=$(number "$2" 600)
  code=$(cat "$login_file" 2>/dev/null)
  while [ "$left" -gt 0 ]; do
    sleep "$interval"
    left=$((left - interval))
    # Finished elsewhere (status or a session start), or a newer login took over.
    { [ -f "$login_file" ] && [ "$(cat "$login_file" 2>/dev/null)" = "$code" ]; } || exit 0
    poll_login
    case $? in 0) exit 0 ;; 3) exit 1 ;; 2) interval=$((interval + 5)) ;; esac
  done
  end_login
  echo "Venom hooks: the sign-in code expired. Run login again."
  exit 1
}

login() {
  command -v curl >/dev/null 2>&1 || { echo "Venom hooks: signing in needs curl."; exit 1; }
  private_conf || { echo "Venom hooks: no private folder for the sign-in (${conf:-set HOME})."; exit 1; }
  name=$(hostname 2>/dev/null | tr -cd 'A-Za-z0-9._-' | cut -c1-64)
  reply=$(curl -s --connect-timeout 5 --max-time 15 --data-urlencode "device_name=$name" "$SERVER/hooks/v1/device" 2>/dev/null)
  device=$(field device_code "$reply")
  code=$(field user_code "$reply")
  link=$(field verification_uri_complete "$reply")
  interval=$(number "$(field interval "$reply")" 5)
  expires=$(number "$(field expires_in "$reply")" 600)
  if [ -z "$device" ] || [ -z "$link" ]; then
    echo "Venom hooks: the sign-in could not start. Check the connection and try again."
    exit 1
  fi
  # Until it is approved, an earlier sign-in on this machine keeps working.
  (umask 077 && printf '%s' "$device" > "$login_file" && printf '%s' "$SERVER" > "$login_file.server") 2>/dev/null || exit 1
  printf 'To sign in Venom hooks on this machine, open this link and approve it:\n\n  %s\n\nThe page should show the code %s.\n' "$link" "$code"
  # In a terminal, wait here; an agent's shell gets its answer at once.
  if [ "${2:-}" = "--wait" ] || { [ -t 0 ] && [ -t 1 ]; }; then
    echo "Waiting for the approval..."
    wait_login "$interval" "$expires"
  fi
  nohup sh "$self" login-wait "$interval" "$expires" >/dev/null 2>&1 &
  printf "It finishes on its own once approved. Check with: sh '%s' status\n" "$self"
  exit 0
}

case $event in
  login) login "$@" ;;
  login-wait) wait_login "${2:-5}" "${3:-600}" ;;
  logout)
    if signed_in; then revoke; echo "Signed out of Venom hooks on this machine."; else echo "Venom hooks weren't signed in."; fi
    exit 0
    ;;
  status)
    # If the background wait was stopped (the machine slept, say), finish here.
    if login_pending; then poll_login >/dev/null; elif [ -n "$conf" ] && [ -f "$login_file" ]; then end_login; fi
    if signed_in; then
      org=$(setting organization)
      echo "Venom hooks are signed in${org:+ to $org} on this machine."
    elif login_pending; then
      echo "Venom hooks: waiting for the sign-in to be approved."
    else
      printf "Venom hooks aren't signed in on this machine. Sign in with: sh '%s' login\n" "$self"
    fi
    exit 0
    ;;
esac

input=$(cat 2>/dev/null) || input=""

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
  pre-compact) say "$PRE_COMPACT" ;;
  compacted) say "$COMPACTED" ;;
  subagent) say "$SUBAGENT" ;;
  session-start | session-extra | post-tool | stop) ;;
  *) exit 0 ;;
esac

# With no session id in the payload, key state by the agent's process: the
# first ancestor that isn't a shell (the hook's own sh and wrappers are).
host_pid() {
  p=$PPID n=0
  while [ "$n" -lt 4 ] && [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    c=$(ps -o comm= -p "$p" 2>/dev/null | sed 's#.*/##; s/^-//')
    case $c in
      sh | bash | zsh | dash | ksh | env | timeout | "") p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); n=$((n + 1)) ;;
      *) break ;;
    esac
  done
  printf '%s' "${p:-$PPID}"
}
session=${VENOM_HOOK_SESSION:-$(json_value 'session_id|sessionId|conversation_id|conversationId|session')}
[ -n "$session" ] || session="host-$(host_pid)"
session=$(printf '%s' "$session" | tr -cd 'A-Za-z0-9._-' | cut -c1-80)
# State lives in a folder only this user owns. In a shared /tmp another user
# could create it first or plant a link: then the hooks stay quiet instead.
dir="${TMPDIR:-/tmp}/venom-hooks-$(id -u 2>/dev/null || echo 0)"
(umask 077 && mkdir -p "$dir") 2>/dev/null
if ! { [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ]; }; then
  [ "$event" = session-start ] && say "$SESSION_START"
  exit 0
fi
chmod 700 "$dir" 2>/dev/null
pending="$dir/$session.pending"

# Recent: the file exists and was touched less than $2 minutes ago.
recent() { [ -f "$1" ] && [ -n "$(find "$1" -mmin "-$2" 2>/dev/null)" ]; }

# The signed-in guidance for this session start: status 0 with the text (it
# may be empty), 1 when signed out, 2 when the server can't answer now. After
# a failure the server is skipped for 5 minutes.
server_text() {
  signed_in || return 1
  command -v curl >/dev/null 2>&1 || return 2
  recent "$dir/offline" 5 && return 2
  token=$(setting token) server=$(setting server)
  agent=$(printf '%s' "${VENOM_HOOK_AGENT:-$AGENT}" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9-' | cut -c1-32)
  # A process id is only unique on this machine, today.
  case $session in
    host-* | ppid-* | junie-*) key="$session-$(hostname 2>/dev/null | cksum | cut -d' ' -f1)-$(date +%Y%m%d)" ;;
    *) key=$session ;;
  esac
  from=$(json_value 'source' | tr -cd 'a-z' | cut -c1-16)
  # A reply cut short (curl fails) or that isn't Venom's plain text (a
  # proxy's page, say) counts as no answer.
  reply=$(auth "$token" |
    curl -s -K - -X POST --connect-timeout 1 --max-time 3 \
      --data-urlencode "event=SessionStart" --data-urlencode "source=${from:-startup}" \
      --data-urlencode "session_id=$key" --data-urlencode "agent=${agent:-agent}" \
      -w '\n%{http_code} %{content_type}' "${server:-$SERVER}/hooks/v1/guidance" 2>/dev/null) ||
    { touch "$dir/offline"; return 2; }
  case $(printf '%s\n' "$reply" | tail -n 1) in
    "200 text/plain"*) printf '%s\n' "$reply" | LC_ALL=C sed '$d' | head -c 16000 | utf8 ;;
    401*) rm -f "$token_file"; return 1 ;;
    *) touch "$dir/offline"; return 2 ;;
  esac
}

# Once a day while signed out: how to sign in, for the agent to pass on.
nudge() {
  [ -n "$conf" ] || return 0
  recent "$dir/nudged" 1440 && return 0
  touch "$dir/nudged"
  printf "Venom hooks aren't signed in on this machine, so they can't show the user's Venom projects and unread mentions. To sign in, the user (or you, for them) can run: sh '%s' login. It prints a link for the user to approve in the browser." "$self"
}

if [ "$event" = session-start ] || [ "$event" = session-extra ]; then
  # A sign-in approved while its background wait was stopped finishes here.
  login_pending && poll_login 2 >/dev/null 2>&1
  extra=$(server_text)
  case $? in 1) extra=$(nudge) ;; 2) extra="" ;; esac
  if [ "$event" = session-start ]; then
    say "$SESSION_START${extra:+

$extra}"
  fi
  say "$extra"
fi

if [ "$event" = stop ]; then
  case $input in *'"stop_hook_active": true'* | *'"stop_hook_active":true'* | *'"stopHookActive": true'* | *'"stopHookActive":true'*) exit 0 ;; esac
  [ -f "$pending" ] || exit 0
  # An outcome from more than an hour ago isn't "this turn" any more.
  if ! recent "$pending" 60; then rm -f "$pending"; exit 0; fi
  kind=$(cat "$pending" 2>/dev/null)
  rm -f "$pending"
  recent "$dir/$session.stop" "$STOP_GAP_MINUTES" && exit 0
  touch "$dir/$session.stop"
  say "$(fill "$STOP" "$(what_for "$kind")")"
fi

# post-tool: a Venom log call clears the pending stop question. The tool name
# comes from the payload's tool key, not the whole payload, so a shell command
# that only mentions append_task_log doesn't count.
tool=${VENOM_HOOK_TOOL:-$(json_value 'tool_name|toolName')}
[ -n "$tool" ] || tool=$input
case $tool in *append_task_log* | *append_project_log* | *edit_log_entry*) rm -f "$pending"; exit 0 ;; esac

command=${VENOM_HOOK_COMMAND:-$(json_value 'command|cmd')}
[ -n "$command" ] || exit 0
# Some agents (Go JSON, e.g. Crush) escape & < > as backslash-u codes: decode
# them. A heredoc body is data: drop everything from the first <<. Quoted
# strings are data too (a commit message that says "git push" is not a push).
# JSON line breaks and && || ; | ( { separate commands.
command=$(printf '%s' "$command" | sed -E 's/\\u0026/\&/g; s/\\u003[cC]/</g; s/\\u003[eE]/>/g')
command=${command%%<<*}
command=$(printf '%s' "$command" |
  sed -E 's/\\"([^"\\]|\\[^"])*\\"//g; s/"[^"]*"//g; s/'"'"'[^'"'"']*'"'"'//g; s/\\n/;/g')
# A dry run or a help page isn't a milestone.
case $command in *--dry-run* | *--help*) exit 0 ;; esac
# A command starts after a separator, then optional VAR=value assignments and
# sudo, time, then, do, else, exec, nohup, command or !.
s='(^|[;&|({])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|sudo|time|then|do|else|exec|nohup|command|!)[[:space:]]+)*'
g="${s}git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+"
h="${s}gh([[:space:]]+(-R[[:space:]]*[^[:space:]]+|--repo[= ][^[:space:]]+))*[[:space:]]+"
e='([[:space:]]|[;&|)}]|$)'
has() { printf '%s' "$command" | grep -q -E "$1"; }
kind=""
for k in merge release workflow deploy publish commit push pr issue; do
  case $k in
    commit) p="${g}commit$e" ;;
    push) p="${g}push$e" ;;
    pr) p="${h}pr[[:space:]]+create$e" ;;
    merge) p="${h}pr[[:space:]]+merge$e" ;;
    release) p="${h}release[[:space:]]+create$e" ;;
    issue) p="${h}issue[[:space:]]+close$e" ;;
    workflow) p="${h}workflow[[:space:]]+run$e" ;;
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
