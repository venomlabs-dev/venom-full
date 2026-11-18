// Cline file hooks (TaskStart, PostToolUse) and the CLI plugin. Payloads follow
// Cline's hook docs (sdk/examples/hooks/README.md) and the hook adapters in
// cline/cline: the CLI sends tool_result.input.commands as an array and
// postToolUse.parameters.commands as a JSON string; the VS Code extension
// sends only the postToolUse form.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guidance = JSON.parse(readFileSync(join(here, "guidance.json"), "utf8").toString());
const reply = (text) => JSON.stringify(text ? { cancel: false, contextModification: text } : { cancel: false });

function run(file, payload, tmp) {
  const out = spawnSync("sh", [join(here, "hooks", file)], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim().split("\n").length, 1);
  return out.stdout.trim();
}
const withTmp = (fn) => {
  const tmp = mkdtempSync(join(tmpdir(), "venom-cline-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

// What the CLI sends after run_commands.
const cliPost = (taskId, commands, name = "run_commands") => ({
  hookName: "tool_result",
  clineVersion: "3.0.74",
  taskId,
  workspaceRoots: ["/repo"],
  tool_result: { id: "c1", name, input: { commands }, output: "ok", durationMs: 40 },
  postToolUse: {
    toolName: name,
    parameters: { commands: JSON.stringify(commands) },
    result: "ok",
    success: true,
    executionTimeMs: 40,
  },
});
// What the VS Code extension sends.
const vscodePost = (taskId, commands) => ({
  taskId,
  postToolUse: { toolName: "run_commands", parameters: { commands: JSON.stringify(commands) }, result: "ok", success: true, executionTimeMs: 40 },
});
const milestone = (kind) => reply(guidance.milestone.replace("{what}", guidance.milestones[kind]));

test("TaskStart says the session start text once per task", () =>
  withTmp((tmp) => {
    const start = { hookName: "agent_start", taskId: "task-1", workspaceRoots: ["/repo"], taskStart: { taskMetadata: { taskId: "task-1", ulid: "", initialTask: "fix it" } } };
    assert.equal(run("TaskStart", start, tmp), reply(guidance.session_start));
    assert.equal(run("TaskStart", start, tmp), reply(""));
    assert.equal(run("TaskStart", { ...start, taskId: "task-2" }, tmp), reply(guidance.session_start));
  }));

test("TaskStart for a subagent says the subagent text", () =>
  withTmp((tmp) => {
    const start = { hookName: "agent_start", taskId: "task-9", agent_id: "a2", parent_agent_id: "a1" };
    assert.equal(run("TaskStart", start, tmp), reply(guidance.subagent));
  }));

test("PostToolUse notes milestones from the CLI and VS Code payloads", () =>
  withTmp((tmp) => {
    assert.equal(run("PostToolUse", cliPost("c-a", ['npm test && git commit -m "wip"']), tmp), milestone("commit"));
    assert.equal(run("PostToolUse", vscodePost("v-a", ['npm test && git commit -m "wip"', "git status"]), tmp), milestone("commit"));
    assert.equal(run("PostToolUse", cliPost("c-b", ["git status", "gh pr create --fill"]), tmp), milestone("pr"));
    assert.equal(run("PostToolUse", vscodePost("v-b", ["git push origin main", "gh pr merge 3 --squash"]), tmp), milestone("merge"));
    assert.equal(run("PostToolUse", cliPost("c-c", ["npm publish"], "execute_command"), tmp), milestone("publish"));
  }));

test("PostToolUse ignores other commands and quoted text", () =>
  withTmp((tmp) => {
    assert.equal(run("PostToolUse", cliPost("c-d", ["git status"]), tmp), reply(""));
    assert.equal(run("PostToolUse", vscodePost("v-d", ['echo "git push"', "ls"]), tmp), reply(""));
    assert.equal(run("PostToolUse", { taskId: "c-e", postToolUse: { toolName: "read_files", parameters: { path: "a.ts" }, result: "git push", success: true } }, tmp), reply(""));
  }));

test("a milestone repeats at most once per kind in five minutes", () =>
  withTmp((tmp) => {
    assert.equal(run("PostToolUse", cliPost("c-f", ["git commit -m a"]), tmp), milestone("commit"));
    assert.equal(run("PostToolUse", cliPost("c-f", ["git commit -m b"]), tmp), reply(""));
  }));

test("a Venom log call prints nothing to add and exits cleanly", () =>
  withTmp((tmp) => {
    const log = { taskId: "c-g", hookName: "tool_result", tool_result: { name: "venom__append_task_log", input: { task: "t1", text: "done" }, output: "ok" } };
    assert.equal(run("PostToolUse", log, tmp), reply(""));
  }));

test("empty and broken input still answers with one JSON object", () =>
  withTmp((tmp) => {
    for (const hook of ["TaskStart", "PostToolUse"]) {
      const out = spawnSync("sh", [join(here, "hooks", hook)], { input: "", env: { PATH: process.env.PATH, TMPDIR: tmp }, encoding: "utf8" });
      assert.equal(out.status, 0);
      JSON.parse(out.stdout);
    }
  }));

test("the CLI plugin adds the session text once, the subagent text for subagents", async () => {
  const { default: plugin } = await import(join(here, "plugin/venom.js"));
  assert.equal(plugin.name, "venom");
  assert.deepEqual(plugin.manifest.capabilities, ["hooks"]);
  assert.deepEqual(plugin.hooks.beforeRun({ snapshot: { conversationId: "c" } }), { appendContext: guidance.session_start });
  assert.equal(plugin.hooks.beforeRun({ snapshot: { conversationId: "c" } }), undefined);
  const again = await import(join(here, "plugin/venom.js?second"));
  assert.deepEqual(again.default.hooks.beforeRun({ snapshot: { parentAgentId: "a1" } }), { appendContext: guidance.subagent });
});
