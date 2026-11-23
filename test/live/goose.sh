#!/bin/sh
# Live test of Venom in the real Goose CLI, against a stand-in model
# (mock-model.mjs) and a stand-in for the Venom server's sign-in
# (mock-mcp.mjs). Goose has no Venom Full hooks package: its hooks can't add
# text the model sees. Venom in Goose is two steps, and this test runs both:
#
#   1. `goose plugin install https://github.com/venomlabs-dev/plugin`
#      brings the `venom` skill. The test checks the skill reaches the model.
#   2. The Venom extension link in the plugin README adds the Venom server as
#      a native Streamable HTTP extension with OAuth. The test writes the
#      extension entry that link creates (the URL swapped for the stand-in)
#      and checks Goose asks the user to sign in to it.
#
#   sh test/live/goose.sh       (needs `goose`, `node` and `git` on PATH)
#
# PLUGIN_REPO and PLUGIN_REF pick the plugin checkout (default: the published
# repository's main branch, installed by URL as the README says). Run it on
# Linux (CI): GOOSE_DISABLE_KEYRING keeps secrets out of the system keychain.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d)
pids=""
trap 'for p in $pids; do kill "$p" 2>/dev/null; done; rm -rf "$work"' EXIT
model_port=${MOCK_PORT:-18527}
mcp_port=${MOCK_MCP_PORT:-18528}
log="$work/requests.jsonl"
mcp_log="$work/mcp.jsonl"
: > "$log"
: > "$mcp_log"

export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" XDG_DATA_HOME="$work/home/.local/share" XDG_STATE_HOME="$work/home/.local/state"
mkdir -p "$XDG_CONFIG_HOME/goose"
export GOOSE_DISABLE_KEYRING=1 GOOSE_MODE=auto GOOSE_PROVIDER=openai GOOSE_MODEL=mock-model
export OPENAI_HOST="http://127.0.0.1:$model_port" OPENAI_API_KEY=stand-in
export GOOSE_OAUTH_CALLBACK_TIMEOUT_SECONDS=5 MOCK_COMMAND=none

MOCK_COMMAND=none node "$here/mock-model.mjs" "$model_port" "$log" &
pids="$pids $!"
node "$here/mock-mcp.mjs" "$mcp_port" "$mcp_log" &
pids="$pids $!"
for url in "http://127.0.0.1:$model_port/v1/models" "http://127.0.0.1:$mcp_port/.well-known/oauth-protected-resource"; do
  i=0
  until node -e 'fetch(process.argv[1]).then(() => process.exit(0), () => process.exit(1))' "$url"; do
    i=$((i + 1)); [ "$i" -lt 50 ] || { echo "FAIL: a stand-in didn't start ($url)"; exit 1; }; sleep 0.2
  done
done

fail() { echo "FAIL: $*"; echo "--- model requests"; cut -c1-3000 "$log" || true
  echo "--- stand-in server requests"; cat "$mcp_log" || true
  echo "--- goose logs"; find "$HOME" -path '*goose*' -name '*.log' -exec tail -n 40 {} + 2>/dev/null || true; exit 1; }

goose --version

echo "== plugin install"
repo=${PLUGIN_REPO:-https://github.com/venomlabs-dev/plugin}
plugin="$work/plugin"
if [ -n "${PLUGIN_REF:-}" ]; then
  git clone -q --depth 1 -b "$PLUGIN_REF" "$repo" "$plugin"
  source=$plugin
else
  git clone -q --depth 1 "$repo" "$plugin"
  source=$repo
fi
goose plugin install "$source" 2>&1 | tee "$work/install.txt"
grep -qE '^[[:space:]]*- (venom:)?venom$' "$work/install.txt" || fail "the install imported no venom skill"
goose skills list 2>&1 | tee "$work/skills.txt" || true
grep -q 'venom' "$work/skills.txt" || fail "goose skills list has no venom skill"

echo "== session: the skill"
mkdir -p "$work/repo" && cd "$work/repo"
timeout 120 goose run --no-session -t "What is on my team's plate?" > "$work/session1.txt" 2>&1 || true
cat "$work/session1.txt"
grep -q '/chat/completions' "$log" || fail "goose never called the stand-in model"
desc=$(sed -n 's/^description: //p' "$plugin/skills/venom/SKILL.md" | head -n 1 | cut -c1-50)
[ -n "$desc" ] || fail "the plugin's SKILL.md has no description"
if ! grep -qF "$desc" "$log"; then
  node -e 'for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
    const i = l.toLowerCase().indexOf("skill"); if (i >= 0) console.log("..." + l.slice(Math.max(0, i - 300), i + 900)); }' "$log" | head -c 6000
  fail "the venom skill isn't offered to the model"
fi

echo "== the extension link"
link=$(grep -o 'goose://extension?[^` )]*' "$plugin/README.md" | head -n 1)
[ -n "$link" ] || fail "the plugin README has no Goose extension link"
echo "$link"
# What Goose Desktop writes for this link: an extension keyed by its lower-case
# name, type streamable_http, uri from `url`, enabled.
entry=$(node -e '
  const u = new URL(process.argv[1]); const p = u.searchParams;
  if (p.get("url") !== "https://mcp.venomlabs.dev") { console.error("url is " + p.get("url")); process.exit(1); }
  const name = p.get("name"); if (!name) { console.error("no name"); process.exit(1); }
  const key = name.toLowerCase().replace(/\s/g, "").replace(/[^a-z0-9_-]/g, "_");
  console.log([key, name, p.get("description") || ""].join("\t"));' "$link") || fail "the link doesn't add https://mcp.venomlabs.dev"
key=$(printf '%s' "$entry" | cut -f1)
name=$(printf '%s' "$entry" | cut -f2)
description=$(printf '%s' "$entry" | cut -f3 | sed "s/'/''/g")
cat >> "$XDG_CONFIG_HOME/goose/config.yaml" <<EOF
extensions:
  $key:
    enabled: true
    type: streamable_http
    name: $name
    description: '$description'
    uri: http://127.0.0.1:$mcp_port/
    timeout: 300
EOF
cat "$XDG_CONFIG_HOME/goose/config.yaml"

echo "== session: the server asks for sign-in"
timeout 180 goose run --no-session -t "What is on my team's plate?" > "$work/session2.txt" 2>&1 || true
cat "$work/session2.txt"
grep -q '"path":"/","auth":false' "$mcp_log" || fail "goose never called the Venom server entry"
grep -q '"path":"/register"' "$mcp_log" || fail "goose didn't register for Venom's OAuth sign-in"
grep -qiE "authorize .* at:" "$work/session2.txt" || fail "goose didn't ask the user to sign in"
grep -qF "http://127.0.0.1:$mcp_port/authorize?" "$work/session2.txt" || fail "the sign-in link isn't the server's authorize page"
echo "== registered OAuth client"; grep '"path":"/register"' "$mcp_log" | head -n 1 | cut -c1-600
echo "PASS: the plugin brings the venom skill to the model, and the extension link's server asks for Venom's sign-in"
