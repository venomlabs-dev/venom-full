// The Copilot wrapper: payloads are the real ones Copilot CLI 1.0.114 sent to
// PascalCase hooks (snake_case fields, tool_input as an object).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const folder = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(folder, "..");
const WRAPPER = join(folder, "hooks/venom-copilot.sh");
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
  const tmp = mkdtempSync(join(tmpdir(), "venom-copilot-test-"));
  try { fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const ctx = (sid) => ({ session_id: sid, timestamp: "2026-11-18T16:24:44.737Z", cwd: "/work" });
const bash = (sid, command) => ({
  hook_event_name: "PostToolUse", ...ctx(sid), tool_use_id: "call_1", tool_name: "Bash",
  tool_input: { command, description: "x" },
  tool_result: { result_type: "success", text_result_for_llm: "ok" },
});
const ctxOut = (text) => `${JSON.stringify({ additionalContext: text })}\n`;
const stopOut = (text) => `${JSON.stringify({ decision: "block", reason: text })}\n`;
const milestone = (k) => guidance.milestone.replace("{what}", guidance.milestones[k]);
const stopText = (k) => guidance.stop.replace("{what}", guidance.milestones[k]);

test("hooks.json wires the four events to the wrapper", () => {
  const cfg = JSON.parse(readFileSync(join(folder, "com.github.copilot/hooks/hooks.json"), "utf8"));
  assert.equal(cfg.version, 1);
  assert.deepEqual(Object.keys(cfg.hooks).sort(), ["PostToolUse", "SessionStart", "Stop", "SubagentStart"]);
  for (const [ev, arg] of [["SessionStart", "session-start"], ["SubagentStart", "subagent"], ["PostToolUse", "post-tool"], ["Stop", "stop"]]) {
    assert.match(cfg.hooks[ev][0].bash, new RegExp(`\\$\\{PLUGIN_ROOT\\}/hooks/venom-copilot\\.sh" ${arg}$`));
  }
  const m = new RegExp(`^(?:${cfg.hooks.PostToolUse[0].matcher})$`);
  for (const name of ["Bash", "venom-append_task_log", "venom-append_project_log", "venom-edit_log_entry"]) assert.ok(m.test(name), name);
  assert.ok(!m.test("Read"));
  const manifest = JSON.parse(readFileSync(join(folder, "plugin.json"), "utf8"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
});

test("session start and subagent start add context", () =>
  withTmp((tmp) => {
    const start = { hook_event_name: "SessionStart", ...ctx("s1"), source: "new", initial_prompt: "hi" };
    assert.equal(run("session-start", start, tmp), ctxOut(guidance.session_start));
    assert.equal(run("subagent", { sessionId: "s1", agentName: "explore" }, tmp), ctxOut(guidance.subagent));
  }));

test("milestone after a shell command; non-milestone and other tools stay silent", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", bash("a", "git commit --allow-empty -m x"), tmp), ctxOut(milestone("commit")));
    assert.equal(run("post-tool", bash("b", "git status"), tmp), "");
    assert.equal(run("post-tool", { ...bash("c", "x"), tool_name: "Read", tool_input: { path: "a" } }, tmp), "");
  }));

test("stop asks once after a merge with no Venom log", () =>
  withTmp((tmp) => {
    run("post-tool", bash("s", "gh pr merge 4 --squash"), tmp);
    const stop = { hook_event_name: "Stop", ...ctx("s"), transcript_path: "/t", stop_reason: "end_turn", stop_hook_active: false };
    assert.equal(run("stop", stop, tmp), stopOut(stopText("merge")));
    assert.equal(run("stop", { ...stop, stop_hook_active: true }, tmp), "");
    assert.equal(run("stop", stop, tmp), "");
  }));

test("a Venom log call clears the stop question", () =>
  withTmp((tmp) => {
    run("post-tool", bash("s", "gh pr merge 4"), tmp);
    const log = { hook_event_name: "PostToolUse", ...ctx("s"), tool_name: "venom-append_task_log", tool_input: { text: "done" }, tool_result: { result_type: "success", text_result_for_llm: "ok" } };
    assert.equal(run("post-tool", log, tmp), "");
    assert.equal(run("stop", { hook_event_name: "Stop", ...ctx("s"), stop_hook_active: false }, tmp), "");
  }));

test("subagent PostToolUse and Stop say nothing", () =>
  withTmp((tmp) => {
    const sub = { agent_id: "b41", agent_type: "explore", parent_agent_id: "e9f" };
    const p = { ...bash("b41", "gh pr merge 9"), ...sub };
    assert.equal(run("post-tool", JSON.stringify({ hook_event_name: "PostToolUse", session_id: "b41", timestamp: "t", cwd: "/w", ...sub, tool_name: "Bash", tool_input: { command: "gh pr merge 9" } }), tmp), "");
    assert.equal(run("stop", JSON.stringify({ hook_event_name: "Stop", session_id: "b41", timestamp: "t", cwd: "/w", ...sub, stop_hook_active: false }), tmp), "");
    assert.ok(p.agent_id);
  }));

test("a commit message that mentions agent_id still counts for the root agent", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", bash("q", 'git commit -m "fix \\"agent_id\\" handling"'), tmp), ctxOut(milestone("commit")));
  }));

test("junk input exits 0 and prints nothing", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", "not json", tmp), "");
    assert.equal(run("stop", "", tmp), "");
  }));

// One install brings everything (Agent Plugins 1.0, which awesome-copilot
// requires): the manifest at the root, mcp.json, the skill and the hooks in
// their fixed places.
test("the package is Venom Full for Copilot: server, skill and hooks", () => {
  const manifest = JSON.parse(readFileSync(join(folder, "plugin.json"), "utf8"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "venom-full");
  for (const field of ["hooks", "mcpServers", "skills", "agents"]) {
    assert.equal(manifest[field], undefined, `${field} is not an Agent Plugins 1.0 field`);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(folder, "mcp.json"), "utf8")), {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { venom: { type: "streamable-http", url: "https://mcp.venomlabs.dev" } },
  });
  const skill = readFileSync(join(folder, "skills/venom/SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: venom\ndescription: \S/);
  assert.equal(skill, readFileSync(join(root, "opencode/skills/venom/SKILL.md"), "utf8"));
  const hooks = JSON.parse(readFileSync(join(folder, "com.github.copilot/hooks/hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["PostToolUse", "SessionStart", "Stop", "SubagentStart"]);
});
