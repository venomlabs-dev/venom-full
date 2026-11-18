import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import venom from "../extensions/venom.js";

const root = new URL("..", import.meta.url).pathname;
const shared = JSON.parse(readFileSync(join(root, "../shared/guidance.json"), "utf8"));
const json = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "venom-auggie-"));

// A PostToolUse payload in the shape Auggie documents (docs.augmentcode.com/cli/hooks).
const payload = (command, id = "conv-1", tool = "bash") =>
  JSON.stringify({
    hook_event_name: "PostToolUse",
    hook_type: "PostToolUse",
    cwd: "/work/app",
    conversation_id: id,
    workspace_roots: ["/work/app"],
    tool_name: tool,
    tool_input: { command },
    is_mcp_tool: false,
    tool_output: "ok",
    tool_result: [{ type: "text", text: "ok" }],
    tool_is_error: false,
  });
const run = (input) =>
  spawnSync("sh", [join(root, "hooks/post-tool.sh")], {
    input,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp },
  });
const note = (what) => shared.milestone.replace("{what}", what);
const out = (text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }) + "\n";

test("the plugin registers one PostToolUse hook on bash, command type, plugin-root path", () => {
  const hooks = json("hooks/hooks.json").hooks;
  assert.deepEqual(Object.keys(hooks), ["PostToolUse"]);
  const [group] = hooks.PostToolUse;
  assert.equal(group.matcher, "bash");
  assert.equal(group.hooks.length, 1);
  assert.equal(group.hooks[0].type, "command");
  assert.deepEqual(group.hooks[0].args, ["${AUGMENT_PLUGIN_ROOT}/hooks/post-tool.sh"]);
  assert.equal(json(".augment-plugin/plugin.json").name, "venom-hooks");
  assert.equal(json(".augment-plugin/marketplace.json").plugins[0].source, "./");
  assert.ok(statSync(join(root, "hooks/post-tool.sh")).mode & 0o100);
});

test("guidance.json is the shared one", () => {
  assert.deepEqual(json("guidance.json"), shared);
});

test("a milestone becomes additionalContext, once per five minutes", () => {
  const first = run(payload("git commit -m 'add login'", "m1"));
  assert.equal(first.status, 0);
  assert.equal(first.stdout, out(note("you committed")));
  assert.doesNotThrow(() => JSON.parse(first.stdout));
  assert.equal(run(payload("git commit -m again", "m1")).stdout, "");
  assert.equal(run(payload("gh pr create --fill", "m1")).stdout, out(note("you opened a pull request")));
});

test("a non-milestone prints nothing and exits 0", () => {
  for (const command of ["git status", "npm test", "echo git push", 'git log --grep="git push"']) {
    const r = run(payload(command, "n1"));
    assert.equal(r.status, 0, command);
    assert.equal(r.stdout, "", command);
  }
  assert.equal(run("").status, 0);
  assert.equal(run("not json").stdout, "");
});

test("the unused stop and log-clearing paths stay silent", () => {
  // Auggie cannot show a Stop hook's output to the model, so none is wired.
  assert.equal(run(payload("gh pr merge 3 --squash", "s1")).stdout, out(note("you merged a pull request")));
  const clear = run(payload("echo append_task_log", "s1"));
  assert.equal(clear.status, 0);
  assert.equal(clear.stdout, "");
});

// The extension: session start, subagent, compaction.
function setup() {
  const handlers = {};
  const sent = [];
  venom({ on: (n, f) => (handlers[n] = f), sendMessage: (m, o) => sent.push([m, o]) });
  return { h: handlers, sent };
}

test("extension: session start said once, on the first prompt", () => {
  const { h } = setup();
  h.session_start({ reason: "startup" });
  assert.deepEqual(h.before_agent_start({}, { role: "parent" }), {
    message: { customType: "venom", content: shared.session_start, display: false },
  });
  assert.equal(h.before_agent_start({}, { role: "parent" }), undefined);
  h.session_start({ reason: "resume" });
  assert.equal(h.before_agent_start({}, { role: "parent" }), undefined);
});

test("extension: a subagent gets the subagent text", () => {
  const { h } = setup();
  h.session_start({ reason: "startup" });
  assert.equal(h.before_agent_start({}, { role: "subagent" }).message.content, shared.subagent);
});

test("extension: compaction queues the re-read note for the next prompt", () => {
  const { h, sent } = setup();
  h.session_compact({});
  assert.deepEqual(sent, [
    [{ customType: "venom", content: shared.compacted, display: false }, { deliverAs: "nextTurn" }],
  ]);
});
