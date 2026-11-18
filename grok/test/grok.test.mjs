// Grok Build wrapper: payloads follow what Grok 1.0.89 sends to hooks.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER = join(root, "grok/hooks/venom-grok.sh");
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));

function run(mode, payload, tmp) {
  const r = spawnSync("sh", [WRAPPER, mode], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-grok-test-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const post = (text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } });
const stopOut = (text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: text } });
const shell = (sessionId, command, extra = {}) => ({
  hookEventName: "post_tool_use",
  sessionId,
  session_id: sessionId,
  toolName: "run_terminal_command",
  tool_name: "run_terminal_command",
  toolInput: { command },
  tool_input: { command },
  toolResult: { type: "Bash", output: [], output_for_prompt: "exit: 0\n", exit_code: 0, command },
  ...extra,
});
const read = (sessionId) => ({
  hookEventName: "post_tool_use",
  sessionId,
  toolName: "read_file",
  toolInput: { target_file: "/x" },
  toolResult: { type: "ReadFile" },
});
const milestone = (kind) => guidance.milestone.replace("{what}", guidance.milestones[kind]);
const stopText = (kind) => guidance.stop.replace("{what}", guidance.milestones[kind]);

test("the first tool call of a session carries the session-start text, once", () =>
  withTmp((tmp) => {
    assert.equal(run("tool", read("s1"), tmp), post(guidance.session_start));
    assert.equal(run("tool", read("s1"), tmp), "");
  }));

test("the first tool call of a subagent carries the subagent text", () =>
  withTmp((tmp) => {
    const out = run("tool", shell("sub1", "ls", { subagentType: "general-purpose" }), tmp);
    assert.equal(out, post(guidance.subagent));
    assert.equal(run("tool", shell("sub1", "ls", { subagentType: "general-purpose" }), tmp), "");
  }));

test("a milestone is added after the session-start text, then alone", () =>
  withTmp((tmp) => {
    assert.equal(
      run("tool", shell("s2", "git commit --allow-empty -m test"), tmp),
      post(`${guidance.session_start} ${milestone("commit")}`),
    );
    assert.equal(run("tool", shell("s2", "git push"), tmp), post(milestone("push")));
    assert.equal(run("tool", shell("s2", "git push"), tmp), "");
  }));

test("a non-milestone command prints nothing", () =>
  withTmp((tmp) => {
    run("tool", read("s3"), tmp);
    assert.equal(run("tool", shell("s3", "git status && ls"), tmp), "");
  }));

test("the compacted text arrives on the next tool call after PostCompact", () =>
  withTmp((tmp) => {
    run("tool", read("s4"), tmp);
    assert.equal(run("compact", { hookEventName: "post_compact", sessionId: "s4" }, tmp), "");
    assert.equal(run("tool", read("s4"), tmp), post(guidance.compacted));
    assert.equal(run("tool", read("s4"), tmp), "");
  }));

test("stop asks once after a merge, never after a plain commit", () =>
  withTmp((tmp) => {
    run("tool", read("s5"), tmp);
    run("tool", shell("s5", "git commit -m x"), tmp);
    const stop = { hookEventName: "stop", sessionId: "s5", reason: "end_turn", stopHookActive: false };
    assert.equal(run("stop", stop, tmp), "");
    run("tool", shell("s5", "gh pr merge 3 --squash"), tmp);
    assert.equal(run("stop", stop, tmp), stopOut(stopText("merge")));
    assert.equal(run("stop", stop, tmp), "");
  }));

test("a Venom log call after the merge clears the stop question", () =>
  withTmp((tmp) => {
    run("tool", read("s6"), tmp);
    run("tool", shell("s6", "gh pr merge 3"), tmp);
    const log = {
      hookEventName: "post_tool_use",
      sessionId: "s6",
      toolName: "venom__append_task_log",
      toolInput: { task_id: "t1", entry: "merged" },
    };
    assert.equal(run("tool", log, tmp), "");
    const stop = { hookEventName: "stop", sessionId: "s6", reason: "end_turn", stopHookActive: false };
    assert.equal(run("stop", stop, tmp), "");
  }));

test("stop stays quiet at session end and while a stop hook is already continuing", () =>
  withTmp((tmp) => {
    run("tool", read("s7"), tmp);
    run("tool", shell("s7", "npm publish"), tmp);
    assert.equal(run("stop", { sessionId: "s7", reason: "shutdown", stopHookActive: false }, tmp), "");
    assert.equal(run("stop", { sessionId: "s7", reason: "end_turn", stopHookActive: true }, tmp), "");
    assert.equal(
      run("stop", { sessionId: "s7", reason: "end_turn", stopHookActive: false }, tmp),
      stopOut(stopText("publish")),
    );
  }));
