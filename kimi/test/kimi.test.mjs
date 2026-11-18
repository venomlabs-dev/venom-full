import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const g = JSON.parse(readFileSync(resolve(pkg, "../shared/guidance.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(pkg, "kimi.plugin.json"), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "venom-kimi-"));
let n = 0;

function session() { return `session_${process.pid}_${++n}`; }
function run(event, payload) {
  const r = spawnSync("sh", [join(pkg, "hooks/kimi-hook.sh"), event], {
    input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, TMPDIR: tmp },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const base = (id, extra) => ({ session_id: id, cwd: "/p", client_type: "kimi_code_cli", ...extra });
const bash = (id, command) => base(id, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, tool_call_id: "c1", tool_output: "ok" });
const logCall = (id) => base(id, { hook_event_name: "PostToolUse", tool_name: "mcp__plugin-venom-venom__append_task_log", tool_input: { task: "t" }, tool_output: "ok" });
const prompt = (id) => base(id, { hook_event_name: "UserPromptSubmit", prompt: [{ type: "text", text: "hi" }], is_steer: false });
const stop = (id) => base(id, { hook_event_name: "Stop", turn_id: 0, step: 2, finish_reason: "completed", stop_hook_active: false });

test("manifest declares the hooks, skill and MCP server", () => {
  assert.equal(manifest.name, "venom");
  assert.deepEqual(manifest.mcpServers.venom, { url: "https://mcp.venomlabs.dev" });
  assert.equal(manifest.sessionStart.skill, "venom");
  assert.deepEqual(manifest.hooks.map((h) => h.event), ["UserPromptSubmit", "PostToolUse", "PostCompact", "Stop"]);
  for (const h of manifest.hooks) assert.match(h.command, /KIMI_PLUGIN_ROOT/);
});

test("first prompt gets the session-start text once", () => {
  const id = session();
  assert.deepEqual(run("UserPromptSubmit", prompt(id)), { code: 0, out: g.session_start + "\n", err: "" });
  assert.deepEqual(run("UserPromptSubmit", prompt(id)), { code: 0, out: "", err: "" });
});

test("a milestone is queued and delivered with the next prompt", () => {
  const id = session();
  run("UserPromptSubmit", prompt(id));
  const post = run("PostToolUse", bash(id, "git commit -m x"));
  assert.deepEqual(post, { code: 0, out: "", err: "" });
  const expected = g.milestone.replace("{what}", g.milestones.commit) + "\n";
  assert.equal(run("UserPromptSubmit", prompt(id)).out, expected);
  assert.equal(run("UserPromptSubmit", prompt(id)).out, "");
});

test("a non-milestone command queues nothing", () => {
  const id = session();
  run("UserPromptSubmit", prompt(id));
  run("PostToolUse", bash(id, "git status"));
  assert.equal(run("UserPromptSubmit", prompt(id)).out, "");
});

test("compaction queues the re-read note", () => {
  const id = session();
  run("UserPromptSubmit", prompt(id));
  run("PostCompact", base(id, { hook_event_name: "PostCompact", trigger: "auto" }));
  assert.equal(run("UserPromptSubmit", prompt(id)).out, g.compacted + "\n");
});

test("stop asks once after a merge with exit 2 and the reason on stderr", () => {
  const id = session();
  run("PostToolUse", bash(id, "gh pr merge 3 --squash"));
  const first = run("Stop", stop(id));
  assert.equal(first.code, 2);
  assert.equal(first.err, g.stop.replace("{what}", g.milestones.merge) + "\n");
  assert.equal(first.out, "");
  assert.deepEqual(run("Stop", stop(id)), { code: 0, out: "", err: "" });
});

test("stop stays quiet after a commit alone", () => {
  const id = session();
  run("PostToolUse", bash(id, "git commit -m x"));
  assert.deepEqual(run("Stop", stop(id)), { code: 0, out: "", err: "" });
});

test("a Venom log call clears the stop question and queued reminders", () => {
  const id = session();
  run("UserPromptSubmit", prompt(id));
  run("PostToolUse", bash(id, "gh pr merge 3 --squash"));
  run("PostToolUse", logCall(id));
  assert.deepEqual(run("Stop", stop(id)), { code: 0, out: "", err: "" });
  assert.equal(run("UserPromptSubmit", prompt(id)).out, "");
});

test("other tools and output mentioning log tools are ignored", () => {
  const id = session();
  run("UserPromptSubmit", prompt(id));
  run("PostToolUse", bash(id, "gh pr merge 3"));
  run("PostToolUse", { ...bash(id, "echo hi"), tool_output: "append_task_log" });
  run("PostToolUse", base(id, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { command: "git push" } }));
  assert.equal(run("Stop", stop(id)).code, 2);
});
