// Qwen Code wrapper: payloads follow the hook input shapes in Qwen Code's hooks docs.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hooks = JSON.parse(readFileSync(join(root, "qwen/hooks/qwen-hooks.json"), "utf8")).hooks;
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));
const WRAPPER = join(root, "qwen/hooks/venom-qwen.sh");

// Run the command string from qwen-hooks.json the way Qwen Code does (extension path substituted).
function run(event, name, payload, tmp) {
  const hook = hooks[event].flatMap((g) => g.hooks).find((h) => h.name === name);
  const command = hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, join(root, "qwen"));
  const r = spawnSync("sh", ["-c", command], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const ctx = (hookEventName, text) => JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } });
const mk = fn => { const t = mkdtempSync(join(tmpdir(), "venom-qwen-")); try { fn(t); } finally { rmSync(t, { recursive: true, force: true }); } };
const base = { session_id: "s1", transcript_path: "/t", cwd: "/w", permission_mode: "default" };
const shell = (command, session = "s1") => ({ ...base, session_id: session, hook_event_name: "PostToolUse", tool_name: "run_shell_command", tool_input: { command, is_background: false }, tool_response: { result_display: "ok" } });
const milestone = (kind) => guidance.milestone.replace("{what}", guidance.milestones[kind]);
const stopText = (kind) => guidance.stop.replace("{what}", guidance.milestones[kind]);

test("hooks file: only these events, sources and matchers", () => {
  assert.deepEqual(Object.keys(hooks).sort(), ["PostToolUse", "PreCompact", "Stop", "SubagentStart", "SessionStart"].sort());
  assert.equal(JSON.parse(readFileSync(join(root, "qwen/qwen-extension.json"), "utf8")).hooks, "hooks/qwen-hooks.json");
  for (const g of Object.values(hooks).flat()) for (const h of g.hooks) assert.equal(h.type, "command");
  assert.match(hooks.SessionStart[0].matcher, /startup/);
  assert.equal(hooks.SessionStart[1].matcher, "compact");
});

test("session start, compaction and subagent add context", () => mk((t) => {
  const start = { ...base, hook_event_name: "SessionStart", source: "startup", model: "m" };
  assert.equal(run("SessionStart", "venom-session-start", start, t), ctx("SessionStart", guidance.session_start));
  assert.equal(run("SessionStart", "venom-compacted", { ...start, source: "compact" }, t), ctx("SessionStart", guidance.compacted));
  assert.equal(run("PreCompact", "venom-pre-compact", { ...base, hook_event_name: "PreCompact", trigger: "auto", custom_instructions: "" }, t), ctx("PreCompact", guidance.pre_compact));
  assert.equal(run("SubagentStart", "venom-subagent", { ...base, hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explorer" }, t), ctx("SubagentStart", guidance.subagent));
}));

test("milestone and non-milestone", () => mk((t) => {
  assert.equal(run("PostToolUse", "venom-post-tool", shell("git commit -m \"wip\""), t), ctx("PostToolUse", milestone("commit")));
  assert.equal(run("PostToolUse", "venom-post-tool", shell("git status", "s2"), t), "");
  assert.equal(run("PostToolUse", "venom-post-tool", shell("echo \"git push\"", "s3"), t), "");
}));

test("stop asks once after an outcome", () => mk((t) => {
  run("PostToolUse", "venom-post-tool", shell("gh pr merge 4 --squash"), t);
  const stop = { ...base, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "x" };
  assert.equal(run("Stop", "venom-stop", stop, t), JSON.stringify({ decision: "block", reason: stopText("merge") }));
  assert.equal(run("Stop", "venom-stop", stop, t), "");
  run("PostToolUse", "venom-post-tool", shell("gh release create v1", "s9"), t);
  assert.equal(run("Stop", "venom-stop", { ...stop, session_id: "s9", stop_hook_active: true }, t), "");
}));

test("a Venom log call clears the stop question", () => mk((t) => {
  run("PostToolUse", "venom-post-tool", shell("gh pr merge 4"), t);
  const log = { ...base, hook_event_name: "PostToolUse", tool_name: "mcp__venom__append_task_log", tool_input: { text: "merged" }, tool_response: {} };
  assert.equal(run("PostToolUse", "venom-post-tool", log, t), "");
  assert.equal(run("Stop", "venom-stop", { ...base, hook_event_name: "Stop", stop_hook_active: false }, t), "");
}));

test("shared copy is in step", () => {
  execFileSync(process.execPath, [join(root, "scripts/sync-shared.mjs"), "--check"], { stdio: "pipe" });
});
