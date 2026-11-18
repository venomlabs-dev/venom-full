// The Antigravity wrapper, run with payloads captured from Antigravity CLI 1.5.11.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER = join(root, "antigravity/hooks/antigravity-hook.sh");
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));

function run(event, payload, tmp) {
  const r = spawnSync("sh", [WRAPPER, event], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-agy-test-"));
  try { fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const common = (id) => ({ conversationId: id, cwd: "/work", hookEventName: "", lastUserInput: "hi", modelName: "gemini-3.8-flash-low", workspacePaths: ["/work"] });
const tool = (id, name, args, error = "") => ({ ...common(id), hookEventName: "PostToolUse", error, stepIdx: 2, toolCall: { args, id: "call_1", name } });
const shell = (id, CommandLine) => tool(id, "run_command", { CommandLine, WaitMsBeforeAsync: 5000, toolSummary: "x" });
const stop = (id, extra = {}) => ({ ...common(id), hookEventName: "Stop", continuationActive: false, error: "", executionNum: 0, fullyIdle: true, terminationReason: "NO_TOOL_CALL", ...extra });
const pre = (id) => ({ ...common(id), hookEventName: "PreInvocation", initialNumSteps: 3, invocationNum: 1 });
const milestone = (k) => guidance.milestone.replace("{what}", guidance.milestones[k]);
const stopText = (k) => guidance.stop.replace("{what}", guidance.milestones[k]);

test("session start injects a system message", () =>
  withTmp((tmp) => {
    assert.equal(run("session-start", common("s1"), tmp),
      JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: guidance.session_start } }] }));
  }));

test("a milestone is held at PostToolUse and injected before the next model call", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", shell("m1", "git commit -m \"wip\""), tmp), "");
    assert.equal(run("pre-invocation", pre("m1"), tmp), JSON.stringify({ injectSteps: [{ ephemeralMessage: milestone("commit") }] }));
    assert.equal(run("pre-invocation", pre("m1"), tmp), "");
  }));

test("non-milestones, quoted text, other tools and failed tools stay quiet", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", shell("n1", "git status"), tmp), "");
    assert.equal(run("post-tool", shell("n1", "echo \"git push\""), tmp), "");
    assert.equal(run("post-tool", tool("n1", "view_file", { CommandLine: "git push" }), tmp), "");
    assert.equal(run("post-tool", tool("n1", "run_command", { CommandLine: "git push" }, "boom"), tmp), "");
    assert.equal(run("pre-invocation", pre("n1"), tmp), "");
  }));

test("stop asks once after a merge, not when continuing, not twice", () =>
  withTmp((tmp) => {
    run("post-tool", shell("p1", "gh pr merge 3 --squash"), tmp);
    assert.equal(run("stop", stop("p1", { continuationActive: true }), tmp), "");
    assert.equal(run("stop", stop("p1"), tmp), JSON.stringify({ decision: "continue", reason: stopText("merge") }));
    assert.equal(run("stop", stop("p1"), tmp), "");
  }));

test("a Venom log call clears the pending stop question", () =>
  withTmp((tmp) => {
    run("post-tool", shell("q1", "npm publish"), tmp);
    run("post-tool", tool("q1", "mcp_venom_append_task_log", { task: "t" }), tmp);
    assert.equal(run("stop", stop("q1"), tmp), "");
  }));

test("a state folder that is a link: no outbox is written or read", () =>
  withTmp((tmp) => {
    symlinkSync(tmp, join(tmp, `venom-hooks-${process.getuid()}`));
    assert.equal(run("post-tool", shell("lk", "git commit -m \"wip\""), tmp), "");
    assert.equal(run("pre-invocation", pre("lk"), tmp), "");
    assert.equal(existsSync(join(tmp, "lk.outbox")), false);
  }));
