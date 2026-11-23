#!/bin/sh
# Live check that the real Cline CLI, on a real model, installs Venom from
# nothing but the published llms-install.md: the way Cline's MCP marketplace
# one-click install works (the task names the repository and carries its
# install file). The model is GitHub Models, reached with the job's own
# GITHUB_TOKEN, so no key is stored anywhere. Linux CI only: the Cline CLI uses
# the macOS keychain.
#
#   GITHUB_TOKEN=... sh cline/test/live/install.sh
#   PLUGIN_REF=<branch>   test an unmerged llms-install.md (default main)
#   MODEL=<id>            a GitHub Models id (default openai/gpt-4.1)
set -eu
model=${MODEL:-openai/gpt-4.1}
ref=${PLUGIN_REF:-main}
base=https://models.github.ai/inference
work=$(mktemp -d)
out=${OUT_DIR:-$work}
export HOME="$work/home"
mkdir -p "$HOME" "$out"

fail() { echo "FAIL: $*"; exit 1; }

echo "== the model answers"
curl -fsS "$base/chat/completions" -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK.\"}],\"max_tokens\":5}" \
  > "$out/probe.json" || fail "GitHub Models didn't answer (models: read permission, or the model id)"
cat "$out/probe.json"; echo

echo "== Cline uses it"
# Cline's OpenAI-compatible provider: its id differs between Cline surfaces.
cline auth --provider openai --apikey "$GITHUB_TOKEN" --modelid "$model" --baseurl "$base" ||
  cline auth --provider openai-compatible --apikey "$GITHUB_TOKEN" --modelid "$model" --baseurl "$base" ||
  { cline auth --help; fail "cline auth didn't take an OpenAI-compatible provider"; }

project="$work/project"
mkdir -p "$project" && cd "$project"
git init -q
curl -fsSL "https://raw.githubusercontent.com/venomlabs-dev/plugin/$ref/llms-install.md" -o "$work/llms-install.md"

# Cline's marketplace task: the repository and its install file, nothing else.
prompt="Set up the MCP server from https://github.com/venomlabs-dev/plugin while adhering to these MCP server installation rules:
- Use \"venom\" as the server name.
- Read the existing MCP settings before changing them, and don't overwrite any existing servers.
- Use commands aligned with the user's shell and operating system best practices.
- Follow the install file below. If a step needs the user (a sign-in), say so and continue with the rest.
Here is the project's llms-install.md:

$(cat "$work/llms-install.md")"

cline --yolo --json "$prompt" > "$out/run.jsonl" 2>&1 || echo "(cline exited non-zero)"
tail -c 4000 "$out/run.jsonl"; echo

echo "== what Cline set up"
settings=$(find "$HOME" -name cline_mcp_settings.json 2>/dev/null | head -n 1)
[ -n "$settings" ] || fail "no cline_mcp_settings.json under HOME"
cat "$settings"
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).mcpServers || {};
const v = s.venom;
if (!v) { console.error("no venom server"); process.exit(1); }
const url = (v.url || "").replace(/\/$/, "");
if (url !== "https://mcp.venomlabs.dev") { console.error("wrong url", v.url); process.exit(1); }
if (!/^(streamableHttp|streamable-http|http)$/.test(v.type || v.transportType || "")) { console.error("not streamable http", v); process.exit(1); }
' "$settings" || fail "venom server missing or wrong in $settings"
[ -f .clinerules/venom.md ] || [ -f "$HOME/Documents/Cline/Rules/venom.md" ] || fail "Venom's rule wasn't added"
grep -q "Venom is where your team's AI agents share their work" .clinerules/venom.md "$HOME/Documents/Cline/Rules/venom.md" 2>/dev/null || fail "the rule file isn't Venom's"
skill=$(find "$HOME" "$project" -path '*skills/venom/SKILL.md' 2>/dev/null | head -n 1)
[ -n "$skill" ] && echo "skill: $skill" || echo "note: the venom skill wasn't added (optional step)"

echo "== the server wants a sign-in, as llms-install.md says"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST https://mcp.venomlabs.dev \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ci","version":"0"}}}')
[ "$code" = 401 ] || fail "expected 401 from the server before sign-in, got $code"
echo "PASS: Cline ($(cline --version 2>/dev/null | head -n 1)) installed Venom from llms-install.md with $model"
