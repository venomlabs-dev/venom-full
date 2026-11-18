import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import venom, { milestone } from "../extensions/venom.js";

const g = JSON.parse(readFileSync(new URL("../guidance.json", import.meta.url), "utf8"));
const shared = JSON.parse(readFileSync(new URL("../../shared/guidance.json", import.meta.url), "utf8"));
const ctx = { sessionManager: { getSessionId: () => "s1" } };
const milestoneNote = (what) => `\n\n${shared.milestone.replace("{what}", what)}`;

function setup() {
  const handlers = {};
  const sent = [];
  let now = 0;
  venom(
    { on: (n, f) => (handlers[n] = f), sendMessage: (m, o) => sent.push([m, o]) },
    () => now,
  );
  return { h: handlers, sent, tick: (ms) => (now += ms) };
}
const bash = (command, extra = {}) => ({
  toolName: "bash", input: { command }, content: [{ type: "text", text: "out" }], isError: false, ...extra,
});

test("guidance.json is the shared one", () => assert.deepEqual(g, shared));

test("milestones", () => {
  assert.equal(milestone("npm test && git push origin main"), "push");
  assert.equal(milestone("git push && gh pr merge 3 --squash"), "merge");
  assert.equal(milestone('git commit -m "then git push"'), "commit");
  assert.equal(milestone("git status"), null);
  assert.equal(milestone("echo git commit"), null);
  assert.equal(milestone("npx vercel --prod"), "deploy");
});

test("milestone rules: prefixes, gh -R, dry run, help, heredoc", () => {
  assert.equal(milestone("CI=1 git push"), "push");
  assert.equal(milestone("sudo git commit -m x"), "commit");
  assert.equal(milestone("if true; then git push; fi"), "push");
  assert.equal(milestone("{ git commit -m x; }"), "commit");
  assert.equal(milestone("! git push"), "push");
  assert.equal(milestone("gh -R org/repo pr merge 3"), "merge");
  assert.equal(milestone("gh --repo org/repo release create v1"), "release");
  assert.equal(milestone("git push --dry-run"), null);
  assert.equal(milestone("gh pr create --help"), null);
  assert.equal(milestone("cat <<EOF\ngit push\nEOF"), null);
  assert.equal(milestone("git commit -F - <<EOF\nmsg\nEOF"), "commit");
});

test("the stop question is dropped after 60 minutes", () => {
  const { h, tick } = setup();
  h.tool_result(bash("npm publish"), ctx);
  tick(61 * 60 * 1000);
  assert.equal(h.agent_before_settle({ entries: [] }, ctx), undefined);
  h.tool_result(bash("npm publish"), ctx);
  tick(59 * 60 * 1000);
  assert.equal(h.agent_before_settle({ entries: [] }, ctx).continue, true);
});

test("session start: said once, on the first prompt only", () => {
  const { h } = setup();
  h.session_start({ reason: "startup" });
  assert.deepEqual(h.before_agent_start({ messageType: "user" }), {
    message: { customType: "venom", content: shared.session_start, display: false },
  });
  assert.equal(h.before_agent_start({ messageType: "user" }), undefined);
  h.session_start({ reason: "resume" });
  assert.equal(h.before_agent_start({ messageType: "user" }), undefined);
});

test("milestone note is appended to the shell output, once per five minutes", () => {
  const { h, tick } = setup();
  const r = h.tool_result(bash("git commit -m x"), ctx);
  assert.deepEqual(r, { content: [{ type: "text", text: "out" }, { type: "text", text: milestoneNote("you committed") }] });
  assert.equal(h.tool_result(bash("git commit -m y"), ctx), undefined);
  tick(5 * 60 * 1000);
  assert.ok(h.tool_result(bash("git commit -m z"), ctx));
});

test("non-milestones and failed commands add nothing", () => {
  const { h } = setup();
  assert.equal(h.tool_result(bash("git status"), ctx), undefined);
  assert.equal(h.tool_result(bash("git push", { isError: true }), ctx), undefined);
  assert.equal(h.tool_result({ toolName: "read", input: { command: "git push" }, content: [] }, ctx), undefined);
});

test("compaction queues the compacted note for the next prompt", () => {
  const { h, sent } = setup();
  h.session_compact({});
  assert.deepEqual(sent, [[{ customType: "venom", content: shared.compacted, display: false }, { deliverAs: "nextTurn" }]]);
});

test("stop: asked once after a merge, then not again", () => {
  const { h, tick } = setup();
  h.tool_result(bash("gh pr merge 3"), ctx);
  const r = h.agent_before_settle({ entries: [] }, ctx);
  assert.deepEqual(r, {
    entries: [{ type: "custom_message", customType: "venom", content: shared.stop.replace("{what}", "you merged a pull request"), display: false }],
    continue: true,
  });
  assert.equal(h.agent_before_settle({ entries: [] }, ctx), undefined);
  tick(60 * 1000);
  h.tool_result(bash("gh pr merge 4"), ctx);
  assert.equal(h.agent_before_settle({ entries: [] }, ctx), undefined);
});

test("stop: a commit alone does not ask; a Venom log call clears it", () => {
  const { h } = setup();
  h.tool_result(bash("git commit -m x"), ctx);
  assert.equal(h.agent_before_settle({ entries: [] }, ctx), undefined);
  h.tool_result(bash("npm publish"), ctx);
  assert.equal(h.tool_result({ toolName: "mcp__venom__append_task_log", input: {}, content: [] }, ctx), undefined);
  assert.equal(h.agent_before_settle({ entries: [] }, ctx), undefined);
});
