import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import plugin, { SKILL_DIR, SKILL_PATH } from "../index.js";
import { COMPACTED, PRE_COMPACT, SUBAGENT, createState, milestone } from "../guidance.js";

test("milestones match the server's patterns", () => {
  assert.equal(milestone("git commit -m x"), "commit");
  assert.equal(milestone("npm test && git push origin main"), "push");
  assert.equal(milestone("git -C repo push"), "push");
  assert.equal(milestone("git push && gh pr merge 3 --squash"), "merge");
  assert.equal(milestone("gh pr create --fill"), "pr");
  assert.equal(milestone("npx vercel --prod"), "deploy");
  assert.equal(milestone("terraform apply -auto-approve"), "deploy");
  assert.equal(milestone("npm publish"), "publish");
  assert.equal(milestone("git status"), null);
  assert.equal(milestone("echo git commit"), null);
  assert.equal(milestone(undefined), null);
});

test("a milestone is said once per kind every five minutes per session", () => {
  let now = 0;
  const state = createState(() => now);
  assert.match(state.milestoneNote("s1", "git commit -m a"), /you committed/);
  assert.equal(state.milestoneNote("s1", "git commit -m b"), null);
  assert.match(state.milestoneNote("s2", "git commit -m b"), /you committed/);
  assert.match(state.milestoneNote("s1", "git push"), /you pushed/);
  now += 5 * 60 * 1000;
  assert.match(state.milestoneNote("s1", "git commit -m c"), /you committed/);
});

function fakeV2({ parent = null, servers = [] } = {}) {
  const hooks = {};
  const mcp = new Map(servers);
  const skills = new Map();
  const ctx = {
    mcp: {
      transform: async (fn) =>
        fn({ list: () => [...mcp.entries()], get: (n) => mcp.get(n), set: (n, c) => mcp.set(n, c) }),
    },
    skill: {
      transform: async (fn) => fn({ get: (id) => skills.get(id), add: (s) => skills.set(s.id, s) }),
    },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, parentID: sessionID === "child" ? parent : undefined }),
      hook: async (name, fn) => {
        hooks[`session.${name}`] = fn;
      },
    },
    tool: {
      hook: async (name, fn) => {
        hooks[`tool.${name}`] = fn;
      },
    },
  };
  return { ctx, hooks, mcp, skills };
}

test("OpenCode 2: adds the Venom server and skill once", async () => {
  const { ctx, mcp, skills } = fakeV2();
  await plugin.setup(ctx);
  assert.deepEqual(mcp.get("venom"), { type: "remote", url: "https://mcp.venomlabs.dev" });
  const skill = skills.get("venom");
  assert.equal(skill.path, SKILL_PATH);
  assert.equal(skill.content, readFileSync(SKILL_PATH, "utf8"));
  assert.match(skill.description, /^Use before your first reply/);
});

test("OpenCode 2: keeps a Venom server the user already configured", async () => {
  const mine = { type: "remote", url: "https://mcp.venomlabs.dev/", headers: { a: "b" } };
  const { ctx, mcp } = fakeV2({ servers: [["team", mine]] });
  await plugin.setup(ctx);
  assert.equal(mcp.get("venom"), undefined);
  assert.equal(mcp.get("team"), mine);
});

test("OpenCode 2: compaction, re-read after compaction, subagents", async () => {
  const { ctx, hooks } = fakeV2({ parent: "parent" });
  await plugin.setup(ctx);

  const compaction = { sessionID: "s1", system: [] };
  await hooks["session.compaction"](compaction);
  assert.deepEqual(compaction.system, [{ type: "text", text: PRE_COMPACT }]);

  const after = { sessionID: "s1", system: [] };
  await hooks["session.context"](after);
  assert.deepEqual(after.system, [{ type: "text", text: COMPACTED }]);
  const later = { sessionID: "s1", system: [] };
  await hooks["session.context"](later);
  assert.deepEqual(later.system, []);

  const child = { sessionID: "child", system: [] };
  await hooks["session.context"](child);
  assert.deepEqual(child.system, [{ type: "text", text: SUBAGENT }]);
});

test("OpenCode 2: milestone note on a completed shell call", async () => {
  const { ctx, hooks } = fakeV2();
  await plugin.setup(ctx);
  const run = (tool, command, result, status = "completed") => {
    const event = { tool, sessionID: "s1", status, input: { command }, result };
    hooks["tool.execute.after"](event);
    return event.result;
  };
  assert.deepEqual(run("shell", "ls", { content: "a" }), { content: "a" });
  const text = run("shell", "git commit -m x", { content: "done" });
  assert.match(text.content, /^done\n\nVenom milestone: you committed/);
  const parts = run("bash", "gh pr create", { content: [{ type: "text", text: "ok" }] });
  assert.equal(parts.content.length, 2);
  assert.match(parts.content[1].text, /opened a pull request/);
  assert.deepEqual(run("shell", "git push", { content: "x" }, "error"), { content: "x" });
});

test("OpenCode 1: config, compaction, subagents and milestones", async () => {
  const client = {
    session: { get: async ({ path }) => ({ data: { id: path.id, parentID: path.id === "child" ? "p" : undefined } }) },
  };
  const hooks = await plugin.server({ client });

  const config = { mcp: { other: { type: "local", command: ["x"] } } };
  await hooks.config(config);
  assert.deepEqual(config.mcp.venom, { type: "remote", url: "https://mcp.venomlabs.dev" });
  assert.ok(config.mcp.other);
  assert.deepEqual(config.skills.paths, [SKILL_DIR]);
  await hooks.config(config);
  assert.deepEqual(config.skills.paths, [SKILL_DIR]);

  const compacting = { context: [] };
  await hooks["experimental.session.compacting"]({ sessionID: "s1" }, compacting);
  assert.deepEqual(compacting.context, [PRE_COMPACT]);

  await hooks.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } });
  const system = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, system);
  assert.deepEqual(system.system, [COMPACTED]);

  const child = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "child" }, child);
  assert.deepEqual(child.system, [SUBAGENT]);

  const output = { output: "[main 1a2b3c] x" };
  await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s1", args: { command: "git commit -m x" } }, output);
  assert.match(output.output, /you committed/);
  const read = { output: "file" };
  await hooks["tool.execute.after"]({ tool: "read", sessionID: "s1", args: {} }, read);
  assert.equal(read.output, "file");
});
