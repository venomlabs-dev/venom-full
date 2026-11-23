#!/bin/sh
# Live test of Venom Full for OpenHands in the real OpenHands Software Agent
# SDK (what Agent Canvas, OpenHands Cloud and SDK scripts run), against a
# stand-in model (test/live/mock-model.mjs). It proves the package loads into a
# conversation without being named, the skill and the session-start text reach
# the model, and after a merge the stop question does. Then it starts the
# OpenHands agent server and adds the Venom server the way Agent Canvas's MCP
# settings do (OAuth), against a stand-in for Venom's sign-in
# (test/live/mock-mcp.mjs), and checks it asks the user to sign in.
#
#   sh openhands/test/live/run.sh   (needs python3 with openhands-sdk,
#                                   openhands-tools and openhands-agent-server,
#                                   plus node and git)
#
# ROUTE picks how the package is installed: folder (default; a copy in
# ~/.openhands/plugins), installed (install_plugin from this folder) or github
# (install_plugin from venomlabs-dev/venom-full main, after a merge).
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pkg=$(CDPATH= cd -- "$here/../.." && pwd)
root=$(CDPATH= cd -- "$pkg/.." && pwd)
route=${ROUTE:-folder}
work=$(mktemp -d)
pids=""
trap 'for p in $pids; do kill "$p" 2>/dev/null; done; rm -rf "$work"' EXIT
port=${MOCK_PORT:-18537}
mcp_port=${MOCK_MCP_PORT:-18538}
server_port=${AGENT_SERVER_PORT:-18539}
log="$work/requests.jsonl"
mcp_log="$work/mcp.jsonl"
: > "$log"
: > "$mcp_log"

export HOME="$work/home"
mkdir -p "$HOME" "$work/bin"
# A stand-in gh: the merge is a Venom milestone; nothing leaves the machine.
cat > "$work/bin/gh" <<EOF
#!/bin/sh
echo "\$*" >> "$work/gh.txt"
echo "Merged pull request #1"
EOF
chmod +x "$work/bin/gh"
export PATH="$work/bin:$PATH"

MOCK_COMMAND='git commit --allow-empty -m "venom smoke" && gh pr merge 1 --squash' \
  node "$root/test/live/mock-model.mjs" "$port" "$log" &
pids="$pids $!"
node "$root/test/live/mock-mcp.mjs" "$mcp_port" "$mcp_log" &
pids="$pids $!"
wait_for() {
  i=0
  until node -e 'fetch(process.argv[1]).then(() => process.exit(0), () => process.exit(1))' "$1"; do
    i=$((i + 1)); [ "$i" -lt "${2:-50}" ] || { echo "FAIL: $1 didn't start"; return 1; }; sleep 0.2
  done
}
wait_for "http://127.0.0.1:$port/v1/models" || exit 1
wait_for "http://127.0.0.1:$mcp_port/.well-known/oauth-protected-resource" || exit 1

fail() { echo "FAIL: $*"; echo "--- model requests"; cut -c1-3000 "$log" || true
  echo "--- stand-in server requests"; cat "$mcp_log" || true; exit 1; }

python3 -c 'import importlib.metadata as m; print("openhands-sdk", m.version("openhands-sdk"))'

echo "== install ($route)"
if [ "$route" = folder ]; then
  mkdir -p "$HOME/.openhands/plugins"
  cp -R "$pkg" "$HOME/.openhands/plugins/venom-full"
  rm -rf "$HOME/.openhands/plugins/venom-full/test"
fi

echo "== conversation"
repo="$work/repo"
mkdir -p "$repo" && cd "$repo"
git init -q && git config user.email ci@example.com && git config user.name ci
python3 "$here/conversation.py" "$port" "$repo" "$route" "$pkg" > "$work/conversation.txt" 2>&1 || {
  cat "$work/conversation.txt"; fail "the conversation script failed"; }
cat "$work/conversation.txt"

grep -q '^SKILLS:.*venom' "$work/conversation.txt" || fail "the venom skill didn't load into the conversation"
git log --oneline | grep -q "venom smoke" || fail "the model's terminal call didn't run the commit"
grep -q "pr merge 1" "$work/gh.txt" 2>/dev/null || fail "the model's terminal call didn't run the merge"
session_start=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).session_start)' "$root/shared/guidance.json")
stop=$(node -e 'const g = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(g.stop.replace("{what}", g.milestones.merge))' "$root/shared/guidance.json")
grep -qF "$session_start" "$log" || fail "session start text never reached the model"
grep -qF "$stop" "$log" || fail "the stop question after the merge never reached the model"
desc=$(sed -n 's/^description: //p' "$pkg/skills/venom/SKILL.md" | head -n 1 | cut -c1-50)
if ! grep -qF "$desc" "$log"; then
  node -e 'for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
    const i = l.toLowerCase().indexOf("skill"); if (i >= 0) console.log("..." + l.slice(Math.max(0, i - 300), i + 900)); }' "$log" | head -c 6000
  fail "the venom skill isn't offered to the model"
fi

[ "$route" = folder ] || { echo "PASS ($route): the package loads, and the skill, session start and stop question reach the model"; exit 0; }

echo "== Venom server in OpenHands' MCP settings (OAuth)"
cd "$work"
python3 -m openhands.agent_server --host 127.0.0.1 --port "$server_port" > "$work/agent-server.txt" 2>&1 &
pids="$pids $!"
wait_for "http://127.0.0.1:$server_port/health" 300 || { tail -n 60 "$work/agent-server.txt"; exit 1; }
node -e '
  const [port, mcp] = process.argv.slice(1);
  fetch(`http://127.0.0.1:${port}/api/mcp/oauth/start`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "venom", timeout: 20,
      server: { type: "streamable-http", url: `http://127.0.0.1:${mcp}/`, auth: { strategy: "oauth2" } } }),
  }).then(async (r) => { console.log(r.status, await r.text()); });' "$server_port" "$mcp_port" | tee "$work/oauth.txt"
grep -q '"ok":true' "$work/oauth.txt" || { tail -n 40 "$work/agent-server.txt"; fail "OpenHands didn't start Venom's sign-in"; }
grep -qF "\"authorization_url\":\"http://127.0.0.1:$mcp_port/authorize?" "$work/oauth.txt" || fail "the sign-in link isn't the server's authorize page"
grep -q '"path":"/register"' "$mcp_log" || fail "OpenHands didn't register for Venom's OAuth sign-in"
echo "PASS: the package loads, the skill, session start and stop question reach the model, and the Venom server added in MCP settings asks for sign-in"
