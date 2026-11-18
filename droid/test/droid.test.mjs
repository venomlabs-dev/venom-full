// Factory Droid wrappers: realistic hook payloads (shapes from
// docs.factory.ai/harness/hooks) in, exact reply JSON out.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hooks = join(root, "droid/hooks");
const g = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));

function run(script, args, payload, tmp) {
  const r = spawnSync("sh", [join(hooks, script), ...args], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const ctx = (event, text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const base = (id, name) => ({
  session_id: id,
  transcript_path: "/Users/me/.factory/projects/x/session.jsonl",
  cwd: "/Users/me/project",
  permission_mode: "auto-low",
  hook_event_name: name,
});
const shell = (id, command, output = "") => ({
  ...base(id, "PostToolUse"),
  tool_name: "Execute",
  tool_input: { command, riskLevel: "low" },
  tool_response: { output },
});
const logCall = (id, tool) => ({
  ...base(id, "PostToolUse"),
  tool_name: tool,
  tool_input: { task: "t1", entry: "Shipped" },
  tool_response: { ok: true },
});
const post = (p, tmp) => run("context.sh", ["PostToolUse"], p, tmp);
const stop = (id, tmp, extra = {}) => run("stop.sh", [], { ...base(id, "Stop"), stop_hook_active: false, ...extra }, tmp);
const milestone = (kind) => g.milestone.replace("{what}", g.milestones[kind]);
const stopText = (kind) => g.stop.replace("{what}", g.milestones[kind]);

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-droid-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("hooks.json uses command hooks only, on supported events", () => {
  const cfg = JSON.parse(readFileSync(join(hooks, "hooks.json"), "utf8"));
  const supported = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Notification", "Stop", "SubagentStop", "PreCompact", "SessionStart", "SessionEnd"];
  for (const [event, groups] of Object.entries(cfg)) {
    assert.ok(supported.includes(event), event);
    for (const group of groups) for (const h of group.hooks) {
      assert.equal(h.type, "command");
      assert.match(h.command, /\$\{DROID_PLUGIN_ROOT\}/);
    }
  }
});

test("session start, resume and compaction", () =>
  withTmp((tmp) => {
    const start = { ...base("s1", "SessionStart"), source: "startup" };
    assert.equal(run("context.sh", ["SessionStart"], start, tmp), ctx("SessionStart", g.session_start));
    assert.equal(run("context.sh", ["SessionStart"], { ...start, source: "resume" }, tmp), ctx("SessionStart", g.session_start));
    assert.equal(run("context.sh", ["SessionStart"], { ...start, source: "compact" }, tmp), ctx("SessionStart", g.compacted));
  }));

test("a Task subagent session gets the subagent note", () =>
  withTmp((tmp) => {
    const sub = { ...base("sub1", "SessionStart"), source: "startup", calling_session_id: "parent1" };
    assert.equal(run("context.sh", ["SessionStart"], sub, tmp), ctx("SessionStart", g.subagent));
  }));

test("milestones in Execute calls, and none for other commands", () =>
  withTmp((tmp) => {
    assert.equal(post(shell("a", "git commit -m \"wip\""), tmp), ctx("PostToolUse", milestone("commit")));
    assert.equal(post(shell("b", "git push origin main && gh pr merge 3 --squash"), tmp), ctx("PostToolUse", milestone("merge")));
    assert.equal(post(shell("c", "git status", "nothing to commit"), tmp), "");
    assert.equal(post(shell("d", "echo \"git push\""), tmp), "");
    assert.equal(post({ ...base("e", "PostToolUse"), tool_name: "Read", tool_input: { file_path: "/x" } }, tmp), "");
  }));

test("a milestone is said once per 5 minutes", () =>
  withTmp((tmp) => {
    assert.equal(post(shell("s", "git commit -m x"), tmp), ctx("PostToolUse", milestone("commit")));
    assert.equal(post(shell("s", "git commit --amend"), tmp), "");
  }));

test("stop asks once after an outcome, as a block reason", () =>
  withTmp((tmp) => {
    post(shell("s", "gh pr merge 4"), tmp);
    assert.equal(stop("s", tmp), JSON.stringify({ decision: "block", reason: stopText("merge") }));
    assert.equal(stop("s", tmp), "");
    post(shell("t", "gh release create v1"), tmp);
    assert.equal(stop("t", tmp, { stop_hook_active: true }), "");
  }));

test("a Venom log call clears the stop question; a commit alone never asks", () =>
  withTmp((tmp) => {
    for (const tool of ["venom___append_task_log", "venom___append_project_log", "venom___edit_log_entry"]) {
      const id = `log-${tool}`;
      post(shell(id, "gh pr merge 4"), tmp);
      assert.equal(post(logCall(id, tool), tmp), "");
      assert.equal(stop(id, tmp), "");
    }
    post(shell("c", "git commit -m x"), tmp);
    assert.equal(stop("c", tmp), "");
    // Output that only mentions a log tool does not clear the question.
    post(shell("m", "gh pr merge 5", "append_task_log"), tmp);
    assert.equal(stop("m", tmp), JSON.stringify({ decision: "block", reason: stopText("merge") }));
  }));
