// Venom for OpenCode: one plugin that adds the Venom MCP server, the venom
// skill, and Venom guidance at compaction, in subagents and after milestones.
// It supports OpenCode 2.x (`setup`) and 1.x (`server`) from one export.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPACTED,
  MCP_URL,
  PRE_COMPACT,
  SUBAGENT,
  createState,
  hasVenom,
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
    if (state.takeCompacted(request.sessionID)) {
      request.system.push({ type: "text", text: COMPACTED });
    }
    if (await state.isSubagent(request.sessionID, lookupParent)) {
      request.system.push({ type: "text", text: SUBAGENT });
    }
  });

  await ctx.tool.hook("execute.after", (event) => {
    if (event.status !== "completed" || !isShellTool(event.tool)) return;
    const note = state.milestoneNote(event.sessionID, event.input?.command);
    if (!note) return;
    const result = event.result ?? {};
    if (Array.isArray(result.content)) {
      event.result = { ...result, content: [...result.content, { type: "text", text: note }] };
    } else if (typeof result.content === "string") {
      event.result = { ...result, content: `${result.content}\n\n${note}` };
    } else if (typeof result.output === "string") {
      event.result = { ...result, output: `${result.output}\n\n${note}` };
    } else {
      event.result = { ...result, content: note };
    }
  });
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
    },
    "experimental.session.compacting": async (_input, output) => {
      output.context.push(PRE_COMPACT);
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (state.takeCompacted(input.sessionID)) output.system.push(COMPACTED);
      if (await state.isSubagent(input.sessionID, lookupParent)) output.system.push(SUBAGENT);
    },
    "tool.execute.after": async (input, output) => {
      if (!isShellTool(input.tool)) return;
      const note = state.milestoneNote(input.sessionID, input.args?.command);
      if (note) output.output = `${output.output ?? ""}\n\n${note}`;
    },
  };
}

export default { id: "venom", setup, server };
