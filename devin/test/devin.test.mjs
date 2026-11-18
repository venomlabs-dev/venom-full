import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = join(root, "hooks/devin-hook.sh");
const guidance = JSON.parse(readFileSync(join(root, "../shared/guidance.json"), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "venom-devin-"));

function run(event, payload) {
  const r = spawnSync("sh", [wrapper, event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp },
  });
  assert.equal(r.status, 0);
  return r.stdout;
}
const post = (session, tool_name, tool_input, extra = {}) =>
  run("post-tool", {
    hook_event_name: "PostToolUse", tool_name, tool_input, session_id: session, prompt_id: "p1",
    tool_response: { success: true, output: "ok", error: null }, ...extra,
  });
const ctx = (name, text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: text } }) + "\n";
const milestone = (what) => guidance.milestone.replace("{what}", what);
const stop = (what) => guidance.stop.replace("{what}", what);

test("session start adds the session guidance", () => {
  assert.equal(
    run("session-start", { hook_event_name: "SessionStart", source: "startup", session_id: "s-start" }),
    ctx("SessionStart", guidance.session_start),
  );
});

test("a milestone adds a reminder, repeats are rate limited", () => {
  const out = post("s-mile", "exec", { command: "git commit -m 'Fix login'", shell_id: "main" });
  assert.equal(out, ctx("PostToolUse", milestone(guidance.milestones.commit)));
  assert.equal(post("s-mile", "exec", { command: "git commit -m 'Again'" }), "");
});

test("a non-milestone prints nothing", () => {
  assert.equal(post("s-none", "exec", { command: "ls -la && git status" }), "");
  assert.equal(post("s-none", "exec", { command: "git commit-tree" + "x" }), "");
});

test("a commit message that mentions a push is not a push", () => {
  const out = post("s-msg", "exec", { command: "git commit -m 'remember git push later'" });
  assert.equal(out, ctx("PostToolUse", milestone(guidance.milestones.commit)));
});

test("stop asks once after a merge, as a block decision", () => {
  post("s-stop", "exec", { command: "gh pr merge 12 --squash" });
  const out = run("stop", { hook_event_name: "Stop", stop_hook_active: false, session_id: "s-stop" });
  assert.equal(out, JSON.stringify({ decision: "block", reason: stop(guidance.milestones.merge) }) + "\n");
  assert.equal(run("stop", { hook_event_name: "Stop", stop_hook_active: false, session_id: "s-stop" }), "");
});

test("stop prints nothing when the stop hook is already active", () => {
  post("s-active", "exec", { command: "gh release create v1.0.0" });
  assert.equal(run("stop", { hook_event_name: "Stop", stop_hook_active: true, session_id: "s-active" }), "");
});

test("stop prints nothing after a commit alone", () => {
  post("s-commit", "exec", { command: "git commit -m x" });
  assert.equal(run("stop", { hook_event_name: "Stop", stop_hook_active: false, session_id: "s-commit" }), "");
});

test("a Venom log call clears the pending stop question", () => {
  post("s-log", "exec", { command: "gh pr merge 3" });
  const out = post("s-log", "mcp__venom__append_task_log", { task_id: "t1", entry: "Merged" });
  assert.equal(out, "");
  assert.equal(run("stop", { hook_event_name: "Stop", stop_hook_active: false, session_id: "s-log" }), "");
});

test("a command that only names a log tool does not clear it", () => {
  post("s-name", "exec", { command: "gh pr merge 4" });
  post("s-name", "exec", { command: "grep append_task_log README.md" });
  const out = run("stop", { hook_event_name: "Stop", stop_hook_active: false, session_id: "s-name" });
  assert.match(out, /"decision":"block"/);
});

test("unknown events and empty input print nothing and exit 0", () => {
  assert.equal(run("pre-compact", {}), "");
  const r = spawnSync("sh", [wrapper, "post-tool"], { input: "", encoding: "utf8", env: { ...process.env, TMPDIR: tmp } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("hook files point at the wrapper and use real Devin events", () => {
  const plugin = JSON.parse(readFileSync(join(root, "hooks.json"), "utf8")).hooks;
  const file = JSON.parse(readFileSync(join(root, "hooks.v1.json"), "utf8"));
  for (const hooks of [plugin, file]) {
    assert.deepEqual(Object.keys(hooks), ["SessionStart", "PostToolUse", "Stop"]);
    for (const [ev, arg] of [["SessionStart", "session-start"], ["PostToolUse", "post-tool"], ["Stop", "stop"]]) {
      const h = hooks[ev][0].hooks[0];
      assert.equal(h.type, "command");
      assert.match(h.command, new RegExp(`devin-hook\\.sh" ${arg}$`));
    }
  }
  const m = new RegExp(file.PostToolUse[0].matcher);
  assert.ok(m.test("exec") && m.test("mcp__venom__append_task_log") && !m.test("read") && !m.test("execute_x"));
  assert.equal(JSON.parse(readFileSync(join(root, ".devin-plugin/plugin.json"), "utf8")).name, "venom-full");
});
