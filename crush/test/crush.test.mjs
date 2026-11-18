// Crush wrapper: payloads copied from Crush's docs/hooks/README.md, including
// Crush's & escaping of & in JSON.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER = join(root, "crush/hooks/crush-hook.sh");
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));

function run(mode, payload, tmp, env = {}) {
  const r = spawnSync("sh", [WRAPPER, mode], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp, CRUSH_PROJECT_DIR: "/work/app", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const withTmp = (fn) => {
  const tmp = mkdtempSync(join(tmpdir(), "venom-crush-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
const ctx = (text) => JSON.stringify({ context: text });
const pre = (session, tool = "bash") => ({ event: "PreToolUse", hook_event_name: "PreToolUse", session_id: session, cwd: "/work/app", tool_name: tool, tool_input: { command: "ls" }, tool_use_id: "call_01" });
const post = (session, command, tool = "bash") => ({ event: "PostToolUse", hook_event_name: "PostToolUse", session_id: session, cwd: "/work/app", tool_name: tool, tool_input: { command }, tool_use_id: "call_02", tool_response: "ok" });
const milestone = (kind) => guidance.milestone.replace("{what}", guidance.milestones[kind]);
const stop = (kind) => guidance.stop.replace("{what}", guidance.milestones[kind]);

test("session start text once, on the first tool call of a session", () =>
  withTmp((tmp) => {
    assert.equal(run("pre-tool", pre("s1"), tmp), ctx(guidance.session_start));
    assert.equal(run("pre-tool", pre("s1"), tmp), "");
    assert.equal(run("pre-tool", pre("s2"), tmp), ctx(guidance.session_start));
  }));

test("a first call to a Venom tool counts as start", () =>
  withTmp((tmp) => {
    assert.equal(run("pre-tool", pre("s1", "mcp_venom_search"), tmp), "");
    assert.equal(run("pre-tool", pre("s1"), tmp), "");
  }));

test("compaction text on the next tool call after PostCompact", () =>
  withTmp((tmp) => {
    run("pre-tool", pre("s1"), tmp);
    assert.equal(run("mark-compacted", { event: "PostCompact", session_id: "s1", cwd: "/work/app", trigger: "auto" }, tmp), "");
    assert.equal(run("pre-tool", pre("s1"), tmp), ctx(guidance.compacted));
    assert.equal(run("pre-tool", pre("s1"), tmp), "");
  }));

test("milestone after a shell command, including Crush's \\u0026 escaping", () =>
  withTmp((tmp) => {
    const raw = JSON.stringify(post("s1", "cd app && git commit -m x")).replace(/&/g, "\\u0026");
    const r = spawnSync("sh", [WRAPPER, "post-tool"], { input: raw, env: { PATH: process.env.PATH, TMPDIR: tmp }, encoding: "utf8" });
    assert.equal(r.stdout.trim(), ctx(milestone("commit")));
    assert.equal(run("post-tool", post("s1", "git commit -m y"), tmp), "");
  }));

test("a command that is not a milestone prints nothing", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", post("s1", "npm test"), tmp), "");
    assert.equal(run("post-tool", post("s1", "echo 'git push'"), tmp), "");
  }));

test("Crush has no event that can ask the stop question; core still tracks it", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", post("s1", "gh pr merge 5"), tmp), ctx(milestone("merge")));
    // the shared core's stop text is unused here: nothing in Crush can carry it
    assert.ok(stop("merge").length > 0);
  }));

test("a Venom log call is silent and unknown modes do nothing", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", post("s1", "gh pr merge 5"), tmp, { CRUSH_TOOL_NAME: "bash" }), ctx(milestone("merge")));
    const pending = join(tmp, `venom-hooks-${process.getuid()}`, "s1.pending");
    assert.equal(existsSync(pending), true);
    assert.equal(run("post-tool", { ...post("s1", "x", "mcp_venom_append_task_log"), tool_input: { task_id: "t" } }, tmp, { CRUSH_TOOL_NAME: "mcp_venom_append_task_log" }), "");
    assert.equal(existsSync(pending), false);
    assert.equal(run("nonsense", {}, tmp), "");
  }));
