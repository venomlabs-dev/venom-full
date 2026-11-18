// Muse Code hook wrappers: run with realistic hook payloads, assert the reply JSON.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guidance = JSON.parse(readFileSync(join(dir, "../shared/guidance.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(dir, ".muse-plugin/plugin.json"), "utf8"));

function run(script, payload, tmp) {
  const r = spawnSync("sh", [join(dir, "hooks", script)], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-muse-"));
  try { fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const ctx = (event, text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const base = (event, extra = {}) => ({ hook_event_name: event, session_id: "s1", transcript_path: "/t", permission_mode: "default", ...extra });
const bash = (id, command) =>
  base("PostToolUse", { session_id: id, tool_name: "bash", tool_input: { command }, tool_use_id: "u1", tool_response: {} });
const milestone = (kind) => guidance.milestone.replace("{what}", guidance.milestones[kind]);
const stopText = (kind) => guidance.stop.replace("{what}", guidance.milestones[kind]);

test("manifest hooks all point at existing, distinct scripts", () => {
  const files = manifest.capabilities.hooks.map((h) => h.command[2].match(/^f=(hooks\/[a-z-]+\.sh);/)[1]);
  assert.equal(new Set(files).size, files.length);
  for (const f of files) assert.ok(existsSync(join(dir, f)), f);
  assert.deepEqual(manifest.capabilities.hooks.map((h) => h.event),
    ["SessionStart", "PreCompact", "PostCompact", "SubagentStart", "PostToolUse", "Stop"]);
});

test("fixed events", () =>
  withTmp((tmp) => {
    assert.equal(run("session-start.sh", base("SessionStart", { source: "startup" }), tmp), ctx("SessionStart", guidance.session_start));
    assert.equal(run("pre-compact.sh", base("PreCompact"), tmp), ctx("PreCompact", guidance.pre_compact));
    assert.equal(run("post-compact.sh", base("PostCompact"), tmp), ctx("PostCompact", guidance.compacted));
    assert.equal(run("subagent-start.sh", base("SubagentStart"), tmp), ctx("SubagentStart", guidance.subagent));
  }));

test("milestone, non-milestone, repeat limit", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool.sh", bash("a", "git commit -m wip"), tmp), ctx("PostToolUse", milestone("commit")));
    assert.equal(run("post-tool.sh", bash("a", "git commit -m again"), tmp), "");
    assert.equal(run("post-tool.sh", bash("b", "git status"), tmp), "");
    assert.equal(run("post-tool.sh", base("PostToolUse", { tool_name: "read_file", tool_input: { path: "a" } }), tmp), "");
  }));

test("stop asks once after a merge", () =>
  withTmp((tmp) => {
    run("post-tool.sh", bash("c", "gh pr merge 3 --squash"), tmp);
    const out = run("stop.sh", base("Stop", { session_id: "c", stop_hook_active: false }), tmp);
    assert.equal(out, JSON.stringify({ decision: "block", reason: stopText("merge") }));
    assert.equal(run("stop.sh", base("Stop", { session_id: "c" }), tmp), "");
    assert.equal(run("stop.sh", base("Stop", { session_id: "zz" }), tmp), "");
  }));

test("a Venom log call clears the stop question", () =>
  withTmp((tmp) => {
    run("post-tool.sh", bash("d", "git push && gh pr merge 4"), tmp);
    run("post-tool.sh", base("PostToolUse", { session_id: "d", tool_name: "mcp__venom__append_task_log", tool_input: { task: "t", text: "x" } }), tmp);
    assert.equal(run("stop.sh", base("Stop", { session_id: "d" }), tmp), "");
  }));

test("every manifest command guards its path: quiet exit 0 from another folder, works from the plugin folder", () =>
  withTmp((tmp) => {
    const start = base("SessionStart", { source: "startup" });
    const go = (cwd) => {
      const h = manifest.capabilities.hooks.find((x) => x.id === "session-start");
      const r = spawnSync(h.command[0], h.command.slice(1), {
        cwd, input: JSON.stringify(start), env: { PATH: process.env.PATH, TMPDIR: tmp }, encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    assert.equal(go(tmp), "");
    assert.equal(go(dir), ctx("SessionStart", guidance.session_start));
  }));

test("with no session id the state is keyed by the agent process, so a milestone then stop still pairs", () =>
  withTmp((tmp) => {
    const noId = (event, extra) => ({ hook_event_name: event, ...extra });
    run("post-tool.sh", noId("PostToolUse", { tool_name: "bash", tool_input: { command: "gh pr merge 3" } }), tmp);
    assert.equal(run("stop.sh", noId("Stop", {}), tmp), JSON.stringify({ decision: "block", reason: stopText("merge") }));
  }));
