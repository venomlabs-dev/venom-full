// The OpenHands wrapper: payloads in the shape the OpenHands Software Agent
// SDK 1.63 sends on stdin (HookEvent.model_dump_json(): event_type,
// tool_name, tool_input as an object, session_id, working_dir, metadata).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const folder = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(folder, "..");
const WRAPPER = join(folder, "hooks/venom-openhands.sh");
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));

function run(event, payload, tmp) {
  const r = spawnSync("sh", [WRAPPER, event], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-openhands-test-"));
  try { fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const event = (type, sid, extra = {}) => ({
  event_type: type, tool_name: null, tool_input: null, tool_response: null, message: null,
  session_id: sid, working_dir: "/work", metadata: {}, ...extra,
});
const terminal = (sid, command) => event("PostToolUse", sid, {
  tool_name: "terminal",
  tool_input: { command, is_input: false, timeout: null, reset: false },
  tool_response: { content: [{ type: "text", text: "ok" }], exit_code: 0 },
});
const ctxOut = (text) => `${JSON.stringify({ additionalContext: text })}\n`;
const stopOut = (text) => `${JSON.stringify({ decision: "deny", reason: text })}\n`;
const milestone = (k) => guidance.milestone.replace("{what}", guidance.milestones[k]);
const stopText = (k) => guidance.stop.replace("{what}", guidance.milestones[k]);

test("the package is Agent Plugins 1.0 with the skill and OpenHands hooks, and no server", () => {
  const manifest = JSON.parse(readFileSync(join(folder, "plugin.json"), "utf8"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "venom-full");
  const venomFull = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.version, venomFull.version);
  readFileSync(join(folder, "skills/venom/SKILL.md"), "utf8");
  // A plugin's MCP server gets no OAuth in OpenHands and replaces a server of
  // the same name the user signed in to, so the package carries none.
  assert.throws(() => readFileSync(join(folder, "mcp.json")));
  const cfg = JSON.parse(readFileSync(join(folder, "dev.openhands/hooks/hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(cfg).sort(), ["post_tool_use", "session_start", "stop"]);
  for (const [ev, arg] of [["session_start", "session-start"], ["post_tool_use", "post-tool"], ["stop", "stop"]]) {
    assert.equal(cfg[ev][0].matcher, "*");
    assert.match(cfg[ev][0].hooks[0].command, new RegExp(`^sh "\\$PLUGIN_ROOT/hooks/venom-openhands\\.sh" ${arg}$`));
  }
});
test("session start adds context", () =>
  withTmp((tmp) => {
    assert.equal(run("session-start", event("SessionStart", "c1"), tmp), ctxOut(guidance.session_start));
  }));

test("milestone after a terminal command; non-milestone and other tools stay silent", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", terminal("a", 'git commit --allow-empty -m "x"'), tmp), ctxOut(milestone("commit")));
    assert.equal(run("post-tool", terminal("b", "git status"), tmp), "");
    const edit = event("PostToolUse", "c", { tool_name: "file_editor", tool_input: { command: "view", path: "/work/a" } });
    assert.equal(run("post-tool", edit, tmp), "");
  }));

test("stop asks once after a merge with no Venom log", () =>
  withTmp((tmp) => {
    run("post-tool", terminal("s", "gh pr merge 4 --squash"), tmp);
    const stop = event("Stop", "s", { metadata: { reason: "agent_finished" } });
    assert.equal(run("stop", stop, tmp), stopOut(stopText("merge")));
    assert.equal(run("stop", stop, tmp), "");
  }));

test("a Venom log call clears the stop question", () =>
  withTmp((tmp) => {
    run("post-tool", terminal("s", "gh pr merge 4"), tmp);
    run("post-tool", event("PostToolUse", "s", { tool_name: "venom_append_task_log", tool_input: { body: "done" } }), tmp);
    assert.equal(run("stop", event("Stop", "s", { metadata: { reason: "agent_finished" } }), tmp), "");
  }));

test("sessions are kept apart", () =>
  withTmp((tmp) => {
    run("post-tool", terminal("one", "gh release create v1"), tmp);
    assert.equal(run("stop", event("Stop", "two"), tmp), "");
    assert.equal(run("stop", event("Stop", "one"), tmp), stopOut(stopText("release")));
  }));

test("bad input never fails the agent", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", "not json", tmp), "");
    assert.equal(run("stop", "", tmp), "");
    assert.equal(run("unknown", event("SessionEnd", "x"), tmp), "");
  }));
