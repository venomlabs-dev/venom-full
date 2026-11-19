import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import plugin, { SKILL_DIR, SKILL_PATH, signedIn } from "../index.js";

// No real sign-in in tests: the signed-in text is stubbed (see the test below).
signedIn.fetch = async () => "";
import {
  COMPACTED,
  PRE_COMPACT,
  SESSION_START,
  SUBAGENT,
  createState,
  milestone,
  milestoneText,
  stopText,
} from "../guidance.js";

const shared = JSON.parse(readFileSync(new URL("../../shared/guidance.json", import.meta.url), "utf8"));

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
  assert.deepEqual(after.system, [
    { type: "text", text: SESSION_START },
    { type: "text", text: COMPACTED },
  ]);
  const later = { sessionID: "s1", system: [] };
  await hooks["session.context"](later);
  assert.deepEqual(later.system, [{ type: "text", text: SESSION_START }]);

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
  assert.deepEqual(system.system, [SESSION_START, COMPACTED]);

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

test("texts match shared/guidance.json", () => {
  assert.equal(SESSION_START, shared.session_start);
  assert.equal(PRE_COMPACT, shared.pre_compact);
  assert.equal(COMPACTED, shared.compacted);
  assert.equal(SUBAGENT, shared.subagent);
  for (const kind of Object.keys(shared.milestones)) {
    assert.equal(milestoneText(kind), shared.milestone.replace("{what}", shared.milestones[kind]));
  }
  for (const kind of shared.stop_kinds) {
    assert.equal(stopText(kind), shared.stop.replace("{what}", shared.milestones[kind]));
  }
});

test("stop question: once after an outcome, cleared by a Venom log, not for a commit", () => {
  let now = 0;
  const state = createState(() => now);
  state.notePending("s1", "git commit -m x");
  assert.equal(state.stopQuestion("s1"), null);
  state.notePending("s1", "gh pr merge 3 --squash");
  assert.equal(state.stopQuestion("s1"), stopText("merge"));
  assert.equal(state.stopQuestion("s1"), null);
  state.notePending("s1", "gh pr merge 4");
  assert.equal(state.stopQuestion("s1"), null, "15 minute gap");
  now += 15 * 60 * 1000;
  state.notePending("s1", "npm publish");
  state.clearPending("s1");
  assert.equal(state.stopQuestion("s1"), null);
  state.notePending("s1", "npm publish");
  assert.equal(state.stopQuestion("s1"), stopText("publish"));
});

function eventStream() {
  const queue = [];
  let wake;
  return {
    push(event) {
      queue.push(event);
      wake?.();
    },
    subscribe: ({ signal }) => ({
      async *[Symbol.asyncIterator]() {
        while (!signal.aborted) {
          if (!queue.length) await new Promise((r) => ((wake = r), signal.addEventListener("abort", r)));
          while (queue.length) yield queue.shift();
        }
      },
    }),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test("OpenCode 2: subagents get no session start; idle after a merge asks once", async () => {
  const { ctx, hooks } = fakeV2({ parent: "parent" });
  const stream = eventStream();
  const prompts = [];
  ctx.event = stream;
  ctx.session.prompt = async (input) => prompts.push(input);
  const stop = await plugin.setup(ctx);
  assert.equal(stop, undefined, "setup returns no abort function");

  const child = { sessionID: "child", system: [] };
  await hooks["session.context"](child);
  assert.deepEqual(child.system, [{ type: "text", text: SUBAGENT }]);

  const shell = (sessionID, command) =>
    hooks["tool.execute.after"]({ tool: "bash", sessionID, status: "completed", input: { command }, result: { content: "ok" } });
  await shell("s1", "gh pr merge 3 --squash");
  stream.push({ type: "session.idle", properties: { sessionID: "s1" } });
  stream.push({ type: "session.idle", properties: { sessionID: "s1" } });
  await tick();
  assert.deepEqual(prompts, [{ sessionID: "s1", text: stopText("merge"), delivery: "queue" }]);

  // A Venom log after the milestone clears the question.
  await shell("s2", "npm publish");
  hooks["tool.execute.after"]({ tool: "venom_append_task_log", sessionID: "s2", status: "completed", input: {}, result: {} });
  stream.push({ type: "session.idle", properties: { sessionID: "s2" } });
  // A subagent never writes to Venom, so it is not asked.
  await shell("child", "gh pr merge 9");
  stream.push({ type: "session.idle", properties: { sessionID: "child" } });
  await tick();
  assert.equal(prompts.length, 1);
  void stop;
});

test("OpenCode 1: session start, and the stop question on idle", async () => {
  const sent = [];
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: path.id === "child" ? "p" : undefined } }),
      promptAsync: async (input) => sent.push(input),
      messages: async () => ({
        data: [
          { info: { role: "user", agent: "build", model: { providerID: "anthropic", modelID: "m1" } } },
          { info: { role: "assistant" } },
        ],
      }),
    },
  };
  const hooks = await plugin.server({ client });
  const system = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, system);
  assert.deepEqual(system.system, [SESSION_START]);

  await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s1", args: { command: "gh release create v1" } }, { output: "ok" });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
  assert.deepEqual(sent, [
    {
      path: { id: "s1" },
      body: {
        agent: "build",
        model: { providerID: "anthropic", modelID: "m1" },
        parts: [{ type: "text", text: stopText("release"), synthetic: true }],
      },
    },
  ]);

  await hooks["tool.execute.after"]({ tool: "bash", sessionID: "s3", args: { command: "npm publish" } }, { output: "ok" });
  await hooks["tool.execute.after"]({ tool: "venom_edit_log_entry", sessionID: "s3", args: {} }, { output: "ok" });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s3" } } });
  await hooks["tool.execute.after"]({ tool: "bash", sessionID: "child", args: { command: "gh pr merge 1" } }, { output: "ok" });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "child" } } });
  assert.equal(sent.length, 1);
});

test("OpenCode 1: no stop question after an aborted turn or when the parent lookup fails", async () => {
  const sent = [];
  let aborted = true;
  let lookupFails = false;
  const client = {
    session: {
      get: async ({ path }) => {
        if (lookupFails) throw new Error("down");
        return { data: { id: path.id } };
      },
      promptAsync: async (input) => sent.push(input),
      messages: async () => ({
        data: [{ info: { role: "user" } }, { info: { role: "assistant", error: aborted ? { name: "MessageAbortedError" } : undefined } }],
      }),
    },
  };
  const hooks = await plugin.server({ client });
  const merge = (id) => hooks["tool.execute.after"]({ tool: "bash", sessionID: id, args: { command: "gh pr merge 1" } }, { output: "ok" });
  const idle = (id) => hooks.event({ event: { type: "session.idle", properties: { sessionID: id } } });
  await merge("a");
  await idle("a");
  assert.equal(sent.length, 0, "cancelled turn");
  aborted = false;
  await idle("a");
  assert.equal(sent.length, 0, "the cancelled turn's question was dropped");

  // A failed parent lookup is "unknown": no session start, no stop question.
  await merge("b");
  lookupFails = true;
  const system = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "b" }, system);
  assert.deepEqual(system.system, []);
  await idle("b");
  assert.equal(sent.length, 0);
  lookupFails = false;
  await idle("b");
  assert.equal(sent.length, 1, "asked once the lookup works again");
});

test("OpenCode 2: a failed parent lookup adds no Venom text, and keeps the compaction note", async () => {
  const { ctx, hooks } = fakeV2();
  ctx.session.get = async () => {
    throw new Error("down");
  };
  await plugin.setup(ctx);
  await hooks["session.compaction"]({ sessionID: "s1", system: [] });
  const request = { sessionID: "s1", system: [] };
  await hooks["session.context"](request);
  assert.deepEqual(request.system, []);
});

test("milestones: quotes, line breaks, prefixes, gh flags, dry runs and heredocs", () => {
  assert.equal(milestone('echo "git push" && grep \'gh pr merge\' x'), null);
  assert.equal(milestone('npm test && git commit -m "wip"'), "commit");
  assert.equal(milestone("git status\ngit push"), "push");
  assert.equal(milestone("HUSKY=0 git commit -m x"), "commit");
  assert.equal(milestone("sudo git push"), "push");
  assert.equal(milestone("if true; then git push; fi"), "push");
  assert.equal(milestone("{ git push; }"), "push");
  assert.equal(milestone("time git push"), "push");
  assert.equal(milestone("! git push"), "push");
  assert.equal(milestone("gh -R o/r pr merge 3"), "merge");
  assert.equal(milestone("gh --repo o/r release create v1"), "release");
  assert.equal(milestone("git push --dry-run"), null);
  assert.equal(milestone("gh pr merge --help"), null);
  assert.equal(milestone("cat <<EOF > notes.md\ngit push\nEOF"), null);
});

test("OpenCode 1: signed in, projects and mentions follow the session-start text, fetched once", async () => {
  const asked = [];
  signedIn.fetch = async (session) => (asked.push(session), "Venom projects in Acme you can find work in:\n- Web (web)");
  try {
    const client = {
      session: { get: async ({ path }) => ({ data: { id: path.id, parentID: path.id === "child" ? "p" : undefined } }) },
    };
    const hooks = await plugin.server({ client });
    for (let i = 0; i < 2; i++) {
      const system = { system: [] };
      await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, system);
      assert.deepEqual(system.system, [SESSION_START, "Venom projects in Acme you can find work in:\n- Web (web)"]);
    }
    const child = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "child" }, child);
    assert.deepEqual(child.system, [SUBAGENT]);
    assert.deepEqual(asked, ["s1"]);
  } finally {
    signedIn.fetch = async () => "";
  }
});
