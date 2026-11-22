#!/bin/sh
# Live test of Venom Full for Copilot in the real Copilot CLI, against a
# stand-in model (mock-model.mjs) with COPILOT_OFFLINE=true: no GitHub sign-in,
# no network model. It proves one install brings the server, the skill and the
# hooks, and that the hooks' texts reach the model.
#
#   sh copilot/test/live/run.sh        (needs `copilot` and `node` on PATH)
#
# Run it on Linux (CI). On macOS, Copilot CLI may use the keychain, and a
# throwaway HOME makes macOS ask to reset it.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pkg=$(CDPATH= cd -- "$here/../.." && pwd)
root=$(CDPATH= cd -- "$pkg/.." && pwd)
work=$(mktemp -d)
port=${MOCK_PORT:-18517}
log="$work/requests.jsonl"
: > "$log"

export HOME="$work/home" COPILOT_HOME="$work/home/.copilot" COPILOT_OFFLINE=true
mkdir -p "$COPILOT_HOME"
cat > "$COPILOT_HOME/providers.json" <<EOF
{
  "providers": [{ "name": "mock", "type": "openai", "baseUrl": "http://127.0.0.1:$port/v1" }],
  "models": [{ "id": "mock-model", "provider": "mock", "modelId": "gpt-4.1",
               "maxPromptTokens": 100000, "maxOutputTokens": 4000 }]
}
EOF

node "$here/mock-model.mjs" "$port" "$log" &
mock=$!
trap 'kill $mock 2>/dev/null || true' EXIT
sleep 1

fail() { echo "FAIL: $*"; echo "--- requests"; cut -c1-2000 "$log" || true;
  echo "--- copilot logs"; tail -n 80 "$COPILOT_HOME"/logs/* 2>/dev/null || true; exit 1; }

echo "== install"
copilot plugin install "$pkg"
copilot plugin list | tee "$work/plugins.txt"
grep -q "venom-full" "$work/plugins.txt" || fail "plugin list has no venom-full"
installed=$(find "$COPILOT_HOME" -path '*installed-plugins*' -name plugin.json -exec grep -l '"venom-full"' {} + | head -n 1)
[ -n "$installed" ] || fail "no installed venom-full plugin.json"
dir=$(dirname "$installed")
for f in mcp.json skills/venom/SKILL.md com.github.copilot/hooks/hooks.json hooks/venom-copilot.sh hooks/venom-hook.sh; do
  [ -f "$dir/$f" ] || fail "installed plugin lacks $f"
done

echo "== session"
repo="$work/repo"
mkdir -p "$repo" && cd "$repo"
git init -q && git config user.email ci@example.com && git config user.name ci
copilot -p "Commit the work." --model mock/mock-model --allow-all-tools > "$work/session.txt" 2>&1 || true
cat "$work/session.txt"

session_start=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).session_start)' "$root/shared/guidance.json")
milestone="Venom milestone: you committed"
grep -q "venom smoke" "$log" || fail "the model never got a shell tool (no tool call was made)"
git log --oneline | grep -q "venom smoke" || fail "the shell tool call didn't run the commit"
grep -qF "$session_start" "$log" || fail "session start text never reached the model"
grep -qF "$milestone" "$log" || fail "milestone text never reached the model"
grep -q '"venom"' "$log" || fail "the venom skill isn't offered to the model"
echo "== mcp"
copilot mcp list 2>&1 | tee "$work/mcp.txt" || true
grep -qi "venom" "$work/mcp.txt" || fail "copilot mcp list has no venom server"
echo "PASS: one install brings the server, the skill and the hooks, and the hooks reach the model"
