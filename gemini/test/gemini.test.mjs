// Gemini CLI wrapper: realistic payloads in, exact reply JSON out.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER = join(here, "hooks/gemini-hook.sh");
const guidance = JSON.parse(readFileSync(join(here, "../shared/guidance.json"), "utf8"));

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
  const tmp = mkdtempSync(join(tmpdir(), "venom-gemini-test-"));
  try { fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const base = (name, id) => ({
  session_id: id, transcript_path: "/home/u/.gemini/tmp/p/chats/s.json", cwd: "/work",
  hook_event_name: name, timestamp: "2026-11-18T10:00:00.000Z",
});
const shell = (id, command) => ({
  ...base("AfterTool", id), tool_name: "run_shell_command",
  tool_input: { command, description: "x" },
  tool_response: { llmContent: "Output: ok", returnDisplay: "ok" },
});
const venomLog = (id) => ({
  ...base("AfterTool", id), tool_name: "mcp_venom_append_task_log",
  tool_input: { task_id: "t1", text: "done" }, tool_response: { llmContent: "ok" },
  mcp_context: { server_name: "venom" },
});
const after = (name, text) => JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: text } });
const milestone = (k) => guidance.milestone.replace("{what}", guidance.milestones[k]);
const stopText = (k) => guidance.stop.replace("{what}", guidance.milestones[k]);

test("package files exist and extension hooks parse", () => {
  const manifest = JSON.parse(readFileSync(join(here, "gemini-extension.json"), "utf8"));
  assert.equal(manifest.name, "venom-hooks");
  const hooks = JSON.parse(readFileSync(join(here, "hooks/hooks.json"), "utf8")).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["AfterAgent", "AfterTool", "SessionStart"]);
  for (const groups of Object.values(hooks)) for (const g of groups) for (const h of g.hooks) {
    assert.equal(h.type, "command");
    assert.match(h.command, /\$\{extensionPath\}/);
  }
  assert.ok(existsSync(join(here, "hooks/venom-hook.sh")));
});

test("session start adds the Venom guidance", () =>
  withTmp((tmp) => {
    const p = { ...base("SessionStart", "s1"), source: "startup" };
    assert.equal(run("session-start", p, tmp), after("SessionStart", guidance.session_start));
  }));

test("a milestone adds a reminder; a non-milestone adds nothing", () =>
  withTmp((tmp) => {
    assert.equal(run("post-tool", shell("a", "git add . && git commit -m \"feat: x\""), tmp), after("AfterTool", milestone("commit")));
    assert.equal(run("post-tool", shell("b", "git status"), tmp), "");
    assert.equal(run("post-tool", { ...base("AfterTool", "c"), tool_name: "read_file", tool_input: { file_path: "a" } }, tmp), "");
  }));

test("stop asks once after a merge", () =>
  withTmp((tmp) => {
    run("post-tool", shell("s", "gh pr merge 4 --squash"), tmp);
    const p = { ...base("AfterAgent", "s"), prompt: "go", prompt_response: "done", stop_hook_active: false };
    assert.equal(run("stop", p, tmp), JSON.stringify({ decision: "deny", reason: stopText("merge") }));
    assert.equal(run("stop", p, tmp), "");
  }));

test("a Venom log call clears the stop question", () =>
  withTmp((tmp) => {
    run("post-tool", shell("s", "gh pr merge 4"), tmp);
    assert.equal(run("post-tool", venomLog("s"), tmp), "");
    assert.equal(run("stop", { ...base("AfterAgent", "s"), prompt_response: "x", stop_hook_active: false }, tmp), "");
  }));

test("unknown events and empty input print nothing", () =>
  withTmp((tmp) => {
    assert.equal(run("nope", {}, tmp), "");
    assert.equal(run("stop", {}, tmp), "");
  }));
