// The Cursor wrapper: realistic Cursor hook payloads in, Cursor reply JSON out.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER = join(dir, "hooks/cursor-hook.sh");
const guidance = JSON.parse(readFileSync(join(dir, "../shared/guidance.json"), "utf8"));

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
  const tmp = mkdtempSync(join(tmpdir(), "venom-cursor-test-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const common = (id) => ({
  conversation_id: id,
  generation_id: "gen-1",
  model: "default",
  hook_event_name: "x",
  cursor_version: "2.4.0",
  workspace_roots: ["/work/app"],
  user_email: null,
  transcript_path: null,
});
const shell = (id, command, exitCode = 0) => ({
  ...common(id),
  hook_event_name: "postToolUse",
  tool_name: "Shell",
  tool_input: { command, working_directory: "/work/app" },
  tool_output: JSON.stringify({ exitCode, stdout: "", command: "ignored" }),
  tool_use_id: "t1",
  cwd: "/work/app",
  duration: 120,
});
const mcp = (id, name) => ({
  ...common(id),
  hook_event_name: "postToolUse",
  tool_name: `MCP:${name}`,
  tool_input: { task: "x", body: "git push" },
  tool_output: "{}",
  tool_use_id: "t2",
  cwd: "/work/app",
  duration: 80,
});
const ctx = (text) => JSON.stringify({ additional_context: text });
const milestone = (k) => guidance.milestone.replace("{what}", guidance.milestones[k]);
const stopText = (k) => guidance.stop.replace("{what}", guidance.milestones[k]);

test("sessionStart adds the session guidance", () =>
  withTmp((tmp) => {
    const out = run("session-start", { ...common("c1"), session_id: "c1", is_background_agent: false, composer_mode: "agent" }, tmp);
    assert.equal(out, ctx(guidance.session_start));
  }));

test("subagentStart tells the subagent to report to its parent", () =>
  withTmp((tmp) => {
    const payload = { ...common("c1"), subagent_id: "s1", subagent_type: "generalPurpose", task: "find the bug", parent_conversation_id: "c1", tool_call_id: "tc", subagent_model: "default", is_parallel_worker: false };
    assert.equal(run("subagent", payload, tmp), ctx(guidance.subagent));
  }));

test("postToolUse after a milestone shell command adds a reminder; other commands add nothing", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", shell("a", "git add -A && git commit -m \"git push later\""), tmp), ctx(milestone("commit")));
    assert.equal(run("post-tool", shell("b", "gh pr create --fill"), tmp), ctx(milestone("pr")));
    assert.equal(run("post-tool", shell("c", "git status"), tmp), "");
    assert.equal(run("post-tool", shell("d", "echo hi"), tmp), "");
  }));

test("stop follows up once after a merge, never after a plain commit", () =>
  withTmp((tmp) => {
    run("post-tool", shell("s", "gh pr merge 12 --squash"), tmp);
    const stop = { ...common("s"), status: "completed", loop_count: 0 };
    assert.equal(run("stop", stop, tmp), JSON.stringify({ followup_message: stopText("merge") }));
    assert.equal(run("stop", stop, tmp), "");
    run("post-tool", shell("k", "git commit -m x"), tmp);
    assert.equal(run("stop", { ...common("k"), status: "completed", loop_count: 0 }, tmp), "");
    run("post-tool", shell("x", "npm publish"), tmp);
    assert.equal(run("stop", { ...common("x"), status: "aborted", loop_count: 0 }, tmp), "");
  }));

test("a Venom log call clears the stop question", () =>
  withTmp((tmp) => {
    run("post-tool", shell("v", "gh release create v1.0.0"), tmp);
    assert.equal(run("post-tool", mcp("v", "append_task_log"), tmp), "");
    assert.equal(run("stop", { ...common("v"), status: "completed", loop_count: 0 }, tmp), "");
  }));

test("hooks.json and plugin.json are wired to the wrapper", () => {
  const hooks = JSON.parse(readFileSync(join(dir, "hooks/hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["postToolUse", "sessionStart", "stop", "subagentStart"]);
  for (const entries of Object.values(hooks.hooks)) {
    for (const e of entries) assert.match(e.command, /\$\{CURSOR_PLUGIN_ROOT\}\/hooks\/cursor-hook\.sh/);
  }
  const plugin = JSON.parse(readFileSync(join(dir, ".cursor-plugin/plugin.json"), "utf8"));
  assert.equal(plugin.name, "venom-full");
  assert.equal(plugin.hooks, "hooks/hooks.json");
});
