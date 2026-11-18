// Junie wrapper: payloads follow https://junie.jetbrains.com/docs/junie-cli-hooks.html
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER = join(here, "hooks/junie-hook.sh");
const guidance = JSON.parse(readFileSync(join(here, "../shared/guidance.json"), "utf8"));

function run(mode, payload, tmp) {
  const r = spawnSync("sh", [WRAPPER, mode], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const out = (event, text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const withTmp = (fn) => {
  const tmp = mkdtempSync(join(tmpdir(), "venom-junie-test-"));
  try { fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
};
const bash = (command) => ({
  hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command, run_in_background: false },
  tool_response: { stdout: "ok", stderr: "", exit_code: 0 }, tool_use_id: "t1", duration_ms: 5,
});
const milestone = (kind) => guidance.milestone.replace("{what}", guidance.milestones[kind]);
const stopText = (kind) => guidance.stop.replace("{what}", guidance.milestones[kind]);
const prompt = (id) => ({ hook_event_name: "UserPromptSubmit", session_id: id, cwd: "/p", project_path: "/p", prompt: "fix it" });
const stop = { hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "done" };

test("hooks.json wires only events whose context reaches the model", () => {
  const h = JSON.parse(readFileSync(join(here, "hooks/hooks.json"), "utf8")).hooks;
  assert.deepEqual(Object.keys(h).sort(), ["PostToolUse", "Stop", "UserPromptSubmit"]);
  for (const entries of Object.values(h)) for (const e of entries) for (const c of e.hooks) assert.equal(c.type, "command");
});

test("session start text arrives once per session, on the first prompt", () =>
  withTmp((tmp) => {
    assert.equal(run("prompt", prompt("s1"), tmp), out("UserPromptSubmit", guidance.session_start));
    assert.equal(run("prompt", prompt("s1"), tmp), "");
    assert.equal(run("prompt", prompt("s2"), tmp), out("UserPromptSubmit", guidance.session_start));
  }));

test("milestone after a commit, none for a non-milestone, repeat limited", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", bash("git status"), tmp), "");
    assert.equal(run("post-tool", bash("git commit -m 'wip'"), tmp), out("PostToolUse", milestone("commit")));
    assert.equal(run("post-tool", bash("git commit -m 'again'"), tmp), "");
  }));

test("stop asks once after a merge", () =>
  withTmp((tmp) => {
    assert.equal(run("stop", stop, tmp), "");
    assert.equal(run("post-tool", bash("gh pr merge 7 --squash"), tmp), out("PostToolUse", milestone("merge")));
    assert.equal(run("stop", stop, tmp), out("Stop", stopText("merge")));
    assert.equal(run("stop", stop, tmp), "");
  }));

test("a Venom log call clears the pending stop question", () =>
  withTmp((tmp) => {
    run("post-tool", bash("npm publish"), tmp);
    const log = { hook_event_name: "PostToolUse", tool_name: "mcp__venom__append_task_log", tool_input: { task: "t", text: "x" }, tool_response: {} };
    assert.equal(run("post-tool", log, tmp), "");
    assert.equal(run("stop", stop, tmp), "");
  }));

test("stop_hook_active never asks again", () =>
  withTmp((tmp) => {
    run("post-tool", bash("gh release create v1"), tmp);
    assert.equal(run("stop", { ...stop, stop_hook_active: true }, tmp), "");
  }));
