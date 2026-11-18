// Runs the plugin against a fake OpenClaw api shaped like the documented one
// (api.on, api.session.workflow.*), with payloads from the hook docs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import plugin from "../index.js";
import { createState, milestone } from "../venom.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guidance = JSON.parse(readFileSync(join(root, "guidance.json"), "utf8"));
const milestoneText = (k) => guidance.milestone.replace("{what}", guidance.milestones[k]);
const stopText = (k) => guidance.stop.replace("{what}", guidance.milestones[k]);

function setup({ steer = true } = {}) {
  const handlers = {};
  const queued = [];
  const steered = [];
  const api = {
    on: (name, fn) => (handlers[name] = fn),
    session: {
      workflow: {
        enqueueNextTurnInjection: async (i) => (queued.push(i), { enqueued: true, id: "1", sessionKey: i.sessionKey }),
        steerActiveRun: async (p) => (steered.push(p), steer ? { steered: true } : { steered: false, reason: "no active run" }),
      },
    },
  };
  plugin.register(api);
  return { handlers, queued, steered };
}
const shell = (command, error) => ({ toolName: "exec", params: { command }, ...(error ? { error } : {}) });
const ctx = (sessionKey) => ({ sessionKey });

test("manifest and package are in OpenClaw's format", () => {
  const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.id, plugin.id);
  assert.deepEqual(manifest.skills, ["./skills"]);
  assert.equal(manifest.mcpServers.venom.url, "https://mcp.venomlabs.dev");
  assert.deepEqual(pkg.openclaw.extensions, ["./index.js"]);
  assert.match(readFileSync(join(root, "skills/venom/SKILL.md"), "utf8"), /^name: venom$/m);
});

test("registers the hooks that reach the model", () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers).sort(), [
    "after_compaction", "after_tool_call", "before_agent_finalize", "session_start", "subagent_spawned",
  ]);
});

test("session start queues the text once per session; subagent sessions get the subagent text", async () => {
  const { handlers, queued } = setup();
  await handlers.session_start({ sessionId: "s1", sessionKey: "agent:main:main" }, { sessionId: "s1" });
  await handlers.session_start({ sessionId: "s2", sessionKey: "agent:main:main" }, { sessionId: "s2" });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].text, guidance.session_start);
  assert.equal(queued[0].sessionKey, "agent:main:main");
  await handlers.subagent_spawned({ childSessionKey: "agent:main:subagent:c1", runId: "r" }, {});
  await handlers.session_start({ sessionId: "c", sessionKey: "agent:main:subagent:c1" }, {});
  assert.equal(queued.length, 2);
  assert.equal(queued[1].text, guidance.subagent);
});

test("compaction steers the run with the compacted text", async () => {
  const { handlers, steered } = setup();
  await handlers.after_compaction({ messageCount: 5, compactedCount: 3 }, ctx("k"));
  assert.equal(steered[0].text, guidance.compacted);
});

test("milestone after a shell command; non-milestone and failed commands say nothing", async () => {
  const { handlers, steered } = setup();
  await handlers.after_tool_call(shell("npm test && git commit -m \"git push\""), ctx("k"));
  assert.equal(steered.at(-1).text, milestoneText("commit"));
  await handlers.after_tool_call(shell("git status"), ctx("k"));
  await handlers.after_tool_call(shell("git push", "exit 1"), ctx("k"));
  await handlers.after_tool_call({ toolName: "read", params: { path: "x" } }, ctx("k"));
  assert.equal(steered.length, 1);
  await handlers.after_tool_call(shell("git commit --amend"), ctx("k"));
  assert.equal(steered.length, 1, "same milestone within 5 minutes");
});

test("falls back to the next turn when no run is active", async () => {
  const { handlers, queued } = setup({ steer: false });
  await handlers.after_tool_call(shell("gh pr create --fill"), ctx("k"));
  assert.equal(queued[0].text, milestoneText("pr"));
});

test("stop asks once after an outcome", async () => {
  const { handlers } = setup();
  await handlers.after_tool_call(shell("gh pr merge 4 --squash"), ctx("k"));
  const first = handlers.before_agent_finalize({ sessionId: "s", sessionKey: "k", stopHookActive: false }, ctx("k"));
  assert.equal(first.action, "revise");
  assert.equal(first.reason, stopText("merge"));
  assert.equal(handlers.before_agent_finalize({ sessionId: "s", sessionKey: "k", stopHookActive: false }, ctx("k")), undefined);
  await handlers.after_tool_call(shell("gh release create v1"), ctx("j"));
  assert.equal(handlers.before_agent_finalize({ sessionId: "s", stopHookActive: true }, ctx("j")), undefined);
});

test("a Venom log call clears the stop question; a commit alone never asks", async () => {
  const { handlers } = setup();
  await handlers.after_tool_call(shell("git push && gh pr merge 4"), ctx("k"));
  await handlers.after_tool_call({ toolName: "venom__append_task_log", params: {} }, ctx("k"));
  assert.equal(handlers.before_agent_finalize({ sessionId: "s" }, ctx("k")), undefined);
  await handlers.after_tool_call(shell("git commit -m x"), ctx("c"));
  assert.equal(handlers.before_agent_finalize({ sessionId: "s" }, ctx("c")), undefined);
});

test("milestone patterns match the shared script's", () => {
  assert.equal(milestone("git push origin main && gh pr merge 3 --squash"), "merge");
  assert.equal(milestone("git -C /repo push"), "push");
  assert.equal(milestone("npx vercel deploy --prod"), "deploy");
  assert.equal(milestone("terraform apply -auto-approve"), "deploy");
  assert.equal(milestone("npm publish"), "publish");
  assert.equal(milestone("echo \"git push\" && grep 'gh pr merge' x"), null);
  assert.equal(milestone("git status"), null);
});

test("the 5 minute limit uses the clock", () => {
  let t = 0;
  const state = createState(() => t);
  assert.equal(state.milestoneNote("k", "git commit -m x"), milestoneText("commit"));
  t += 4 * 60000;
  assert.equal(state.milestoneNote("k", "git commit -m y"), null);
  t += 2 * 60000;
  assert.equal(state.milestoneNote("k", "git commit -m z"), milestoneText("commit"));
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
  let t = 0;
  const state = createState(() => t);
  state.milestoneNote("k", "npm publish");
  t += 61 * 60000;
  assert.equal(state.stopNote("k"), null);
  state.milestoneNote("k", "npm publish");
  t += 59 * 60000;
  assert.equal(state.stopNote("k"), stopText("publish"));
});

test("a session named by subagent_spawned gets no stop question", async () => {
  const { handlers } = setup();
  await handlers.subagent_spawned({ childSessionKey: "child-1" }, {});
  await handlers.after_tool_call(shell("gh pr merge 4"), ctx("child-1"));
  assert.equal(handlers.before_agent_finalize({ sessionKey: "child-1" }, ctx("child-1")), undefined);
});
