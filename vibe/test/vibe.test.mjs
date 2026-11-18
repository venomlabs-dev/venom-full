// Mistral Vibe wrappers: payloads follow https://docs.mistral.ai/vibe/code/cli/hooks
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(here, "..");
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));
const CONTEXT = join(here, "hooks/vibe-context.sh");
const STOP = join(here, "hooks/vibe-stop.sh");

function run(script, args, payload, tmp) {
  const r = spawnSync("sh", [script, ...args], {
    input: JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp, PLUGIN_DATA: join(tmp, "data") },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim();
  return out ? JSON.stringify(JSON.parse(out)) : "";
}
function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-vibe-test-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
const ctx = (text) => JSON.stringify({ hook_specific_output: { additional_context: text } });
const base = (session, event) => ({
  session_id: session,
  transcript_path: "/home/u/.vibe/sessions/x",
  cwd: "/home/u/project",
  parent_session_id: null,
  hook_event_name: event,
});
const bash = (session, command, extra = {}) => ({
  ...base(session, "post_tool"),
  tool_name: "file_system.bash",
  tool_call_id: "call_1",
  tool_input: { command },
  tool_status: "success",
  tool_output: { stdout: "ok" },
  tool_output_text: "ok",
  tool_error: null,
  duration_ms: 0,
  ...extra,
});
const venomLog = (session, tool = "venom.append_task_log") => ({
  ...base(session, "post_tool"),
  tool_name: tool,
  tool_call_id: "call_2",
  tool_input: { task_id: "t1", body: "git push done" },
  tool_status: "success",
  tool_output: null,
  tool_output_text: "logged",
  tool_error: null,
  duration_ms: 0,
});
const stop = (session) => ({
  ...base(session, "post_agent"),
  agent_name: "default",
  turn_id: "turn_1",
  response_text: "Merged.",
});
const milestoneText = (kind) => guidance.milestone.replace("{what}", guidance.milestones[kind]);
const stopText = (kind) => guidance.stop.replace("{what}", guidance.milestones[kind]);

test("session start adds the Venom context", () =>
  withTmp((tmp) => {
    const payload = { ...base("s1", "session_start"), source: "startup", agent_name: "default", model: "devstral" };
    assert.equal(run(CONTEXT, ["session-start"], payload, tmp), ctx(guidance.session_start));
  }));

test("a milestone is noted, a non-milestone and a failed command are not", () =>
  withTmp((tmp) => {
    assert.equal(run(CONTEXT, ["post-tool"], bash("m1", "git commit -m \"wip\""), tmp), ctx(milestoneText("commit")));
    assert.equal(run(CONTEXT, ["post-tool"], bash("m2", "git status"), tmp), "");
    assert.equal(run(CONTEXT, ["post-tool"], bash("m3", "git push", { tool_status: "failure", tool_error: "rejected" }), tmp), "");
  }));

test("stop asks once after a merge", () =>
  withTmp((tmp) => {
    assert.equal(run(CONTEXT, ["post-tool"], bash("a", "gh pr merge 3 --squash"), tmp), ctx(milestoneText("merge")));
    assert.equal(
      run(STOP, [], stop("a"), tmp),
      JSON.stringify({ decision: "deny", reason: stopText("merge") }),
    );
    assert.equal(run(STOP, [], stop("a"), tmp), "");
  }));

test("stop stays quiet after a commit alone", () =>
  withTmp((tmp) => {
    run(CONTEXT, ["post-tool"], bash("c", "git commit -m x"), tmp);
    assert.equal(run(STOP, [], stop("c"), tmp), "");
  }));

test("a Venom log call clears the stop question", () =>
  withTmp((tmp) => {
    run(CONTEXT, ["post-tool"], bash("b", "npx vercel deploy --prod"), tmp);
    assert.equal(run(CONTEXT, ["post-tool"], venomLog("b"), tmp), "");
    assert.equal(run(STOP, [], stop("b"), tmp), "");
    run(CONTEXT, ["post-tool"], bash("d", "npm publish"), tmp);
    assert.equal(run(CONTEXT, ["post-tool"], venomLog("d", "venom.edit_log_entry"), tmp), "");
    assert.equal(run(STOP, [], stop("d"), tmp), "");
  }));

test("a shell command that only mentions a Venom log tool does not clear it", () =>
  withTmp((tmp) => {
    run(CONTEXT, ["post-tool"], bash("e", "gh pr merge 4"), tmp);
    run(CONTEXT, ["post-tool"], bash("e", "grep append_task_log notes.md"), tmp);
    assert.equal(run(STOP, [], stop("e"), tmp), JSON.stringify({ decision: "deny", reason: stopText("merge") }));
  }));

test("subagents get the note once; the user's agent never does", () =>
  withTmp((tmp) => {
    const sub = { ...base("child1", "pre_agent"), parent_session_id: "s1", agent_name: "explore", turn_id: "t", prompt: "find x" };
    assert.equal(run(CONTEXT, ["subagent"], sub, tmp), ctx(guidance.subagent));
    assert.equal(run(CONTEXT, ["subagent"], sub, tmp), "");
    const main = { ...base("s1", "pre_agent"), agent_name: "default", turn_id: "t", prompt: "hi" };
    assert.equal(run(CONTEXT, ["subagent"], main, tmp), "");
  }));

test("hooks.toml and plugin.json are wired to the wrappers", () => {
  const toml = readFileSync(join(here, "ai.mistral.vibe/hooks.toml"), "utf8");
  for (const type of ["session_start", "pre_agent", "post_tool", "post_agent"]) {
    assert.match(toml, new RegExp(`type = "${type}"`));
  }
  const manifest = JSON.parse(readFileSync(join(here, "plugin.json"), "utf8"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "venom-full");
  assert.equal(manifest.extensions["ai.mistral.vibe"].schemaVersion, 1);
});
