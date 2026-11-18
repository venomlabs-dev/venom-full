// Venom for OpenCode: one plugin that adds the Venom MCP server, the venom
// skill, and Venom guidance at session start, at compaction, in subagents,
// after milestones and, once, when a session goes idle without a log.
// It supports OpenCode 2.x (`setup`) and 1.x (`server`) from one export.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPACTED,
  MCP_URL,
  PRE_COMPACT,
  SESSION_START,
  SUBAGENT,
  createState,
  hasVenom,
  isLogTool,
  isShellTool,
} from "./guidance.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = join(here, "skills", "venom");
export const SKILL_PATH = join(SKILL_DIR, "SKILL.md");

function skillParts() {
  const content = readFileSync(SKILL_PATH, "utf8");
  const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { content, description };
}

function parentOf(info) {
  const value = info?.data ?? info;
  return value?.parentID ?? value?.parentId ?? value?.parent?.id ?? null;
}

// Stop question: when a session goes idle after a merge, release, workflow,
// deploy or publish that no Venom log followed, send one message asking to log.
async function askStop(state, sessionID, lookupParent, send) {
  if (!sessionID) return;
  if (await state.isSubagent(sessionID, lookupParent)) {
    state.clearPending(sessionID);
    return;
  }
  const text = state.stopQuestion(sessionID);
  if (text) await send(text);
}

// OpenCode 2.x
async function setup(ctx) {
  const state = createState();

  await ctx.mcp.transform((editor) => {
    if (!hasVenom(editor.list())) editor.set("venom", { type: "remote", url: MCP_URL });
  });

  await ctx.skill.transform((editor) => {
    if (editor.get("venom")) return;
    const { content, description } = skillParts();
    editor.add({ id: "venom", name: "venom", description, path: SKILL_PATH, content });
  });

  const lookupParent = async (sessionID) => parentOf(await ctx.session.get({ sessionID }));

  await ctx.session.hook("compaction", (request) => {
    request.system.push({ type: "text", text: PRE_COMPACT });
    state.markCompacted(request.sessionID);
  });

  await ctx.session.hook("context", async (request) => {
    // Subagents get the subagent note; every other session gets the session-start
    // guidance. Changes here last for one model call, so it is added on each.
    const subagent = await state.isSubagent(request.sessionID, lookupParent);
    if (!subagent && request.sessionID) {
      request.system.push({ type: "text", text: SESSION_START });
    }
    if (state.takeCompacted(request.sessionID)) {
      request.system.push({ type: "text", text: COMPACTED });
    }
    if (subagent) request.system.push({ type: "text", text: SUBAGENT });
  });

  await ctx.tool.hook("execute.after", (event) => {
    if (event.status !== "completed") return;
    if (isLogTool(event.tool)) {
      state.clearPending(event.sessionID);
      return;
    }
    if (!isShellTool(event.tool)) return;
    state.notePending(event.sessionID, event.input?.command);
    const note = state.milestoneNote(event.sessionID, event.input?.command);
    if (!note) return;
    const result = event.result ?? {};
    if (Array.isArray(result.content)) {
      event.result = { ...result, content: [...result.content, { type: "text", text: note }] };
    } else if (typeof result.content === "string") {
      event.result = { ...result, content: `${result.content}\n\n${note}` };
    } else if (typeof result.output === "string") {
      event.result = { ...result, output: `${result.output}\n\n${note}` };
    }
    // Any other result shape stays as it is, so the shell output is never hidden.
  });

  // Idle sessions: ask the stop question. Needs the event stream (2.x).
  if (typeof ctx.event?.subscribe === "function") {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event?.type !== "session.idle") continue;
          const sessionID = event.properties?.sessionID ?? event.sessionID;
          await askStop(state, sessionID, lookupParent, (text) =>
            ctx.session.prompt({ sessionID, text, delivery: "queue" }),
          ).catch(() => {});
        }
      } catch {
        // The stream ended or was aborted: nothing more to watch.
      }
    })();
    return () => controller.abort();
  }
}

// OpenCode 1.x
async function server({ client }) {
  const state = createState();
  const lookupParent = async (sessionID) =>
    parentOf(await client.session.get({ path: { id: sessionID } }));

  return {
    config: async (config) => {
      config.mcp ??= {};
      if (!hasVenom(config.mcp)) config.mcp.venom = { type: "remote", url: MCP_URL };
      config.skills ??= {};
      config.skills.paths ??= [];
      if (!config.skills.paths.includes(SKILL_DIR)) config.skills.paths.push(SKILL_DIR);
    },
    event: async ({ event }) => {
      if (event?.type === "session.compacted") {
        state.markCompacted(event.properties?.sessionID);
      }
      if (event?.type === "session.idle") {
        const sessionID = event.properties?.sessionID;
        const ask = client.session.promptAsync ?? client.session.prompt;
        await askStop(state, sessionID, lookupParent, (text) =>
          ask.call(client.session, { path: { id: sessionID }, body: { parts: [{ type: "text", text }] } }),
        ).catch(() => {});
      }
    },
    "experimental.session.compacting": async (_input, output) => {
      output.context.push(PRE_COMPACT);
    },
    "experimental.chat.system.transform": async (input, output) => {
      const subagent = await state.isSubagent(input.sessionID, lookupParent);
      if (!subagent && input.sessionID) output.system.push(SESSION_START);
      if (state.takeCompacted(input.sessionID)) output.system.push(COMPACTED);
      if (subagent) output.system.push(SUBAGENT);
    },
    "tool.execute.after": async (input, output) => {
      if (isLogTool(input.tool)) {
        state.clearPending(input.sessionID);
        return;
      }
      if (!isShellTool(input.tool)) return;
      state.notePending(input.sessionID, input.args?.command);
      const note = state.milestoneNote(input.sessionID, input.args?.command);
      if (note) output.output = `${output.output ?? ""}\n\n${note}`;
    },
  };
}

export default { id: "venom", setup, server };
