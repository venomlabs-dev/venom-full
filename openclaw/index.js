// Venom for OpenClaw: one native plugin that adds the Venom MCP server and the
// venom skill (see openclaw.plugin.json), and Venom guidance at session start,
// after compaction, in subagents and after commits, pushes, PRs and deploys.
//
// Guidance is delivered with the host's own channels for plugin text:
//   - api.session.workflow.enqueueNextTurnInjection: queued context added to the
//     session's next turn (session start, subagents, and the fallback below)
//   - api.session.workflow.steerActiveRun: guidance for the run that is going now
//     (milestones after a shell command, compaction)
//   - before_agent_finalize: asks the agent for one more pass to log an outcome
// None of these needs conversation access except before_agent_finalize.
import {
  createState,
  guidance,
  isShellTool,
  isSubagentSession,
  isVenomLogTool,
} from "./venom.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export default {
  id: "venom",
  name: "Venom",
  description:
    "Venom for OpenClaw: multiplayer AI for your team. Adds the Venom MCP server, the venom skill, and Venom guidance at session start, after compaction, in subagents and after commits, PRs and deploys.",
  register(api) {
    const state = createState();
    const log = (message) => api.logger?.debug?.(`venom: ${message}`);
    let counter = 0;

    async function enqueue(sessionKey, text, idempotencyKey) {
      try {
        await api.session.workflow.enqueueNextTurnInjection({
          sessionKey,
          text,
          idempotencyKey,
          placement: "append_context",
          ttlMs: DAY_MS,
        });
      } catch (error) {
        log(`could not queue guidance: ${error?.message ?? error}`);
      }
    }

    // To the run in progress if there is one, else to the session's next turn.
    async function deliver(sessionKey, text, idempotencyKey) {
      try {
        const result = await api.session.workflow.steerActiveRun({ sessionKey, text, idempotencyKey });
        if (result?.steered || result?.reason === "duplicate") return;
      } catch (error) {
        log(`could not steer the run: ${error?.message ?? error}`);
      }
      await enqueue(sessionKey, text, idempotencyKey);
    }

    const keyOf = (event, ctx) => ctx?.sessionKey ?? event?.sessionKey ?? ctx?.sessionId ?? event?.sessionId;

    api.on("session_start", async (event, ctx) => {
      const key = keyOf(event, ctx);
      if (!state.takeStart(key)) return;
      await enqueue(key, guidance.session_start, `venom:start:${key}`);
    });

    api.on("subagent_spawned", async (event, ctx) => {
      const key = event?.childSessionKey ?? ctx?.childSessionKey;
      if (!key) return;
      state.markSubagent(key);
      await enqueue(key, guidance.subagent, `venom:subagent:${key}`);
    });

    api.on("after_compaction", async (event, ctx) => {
      const key = keyOf(event, ctx);
      if (!key) return;
      await deliver(key, guidance.compacted, `venom:compacted:${key}:${++counter}`);
    });

    api.on("after_tool_call", async (event, ctx) => {
      const key = keyOf(event, ctx);
      if (!key) return;
      const tool = event?.toolName ?? ctx?.toolName;
      if (isVenomLogTool(tool)) return state.logged(key);
      if (!isShellTool(tool) || event?.error) return;
      const command = event?.params?.command ?? event?.params?.cmd;
      const note = state.milestoneNote(key, command);
      if (note) await deliver(key, note, `venom:milestone:${key}:${++counter}`);
    });

    // The agent is about to give its final answer. After a merge, release,
    // workflow, deploy or publish with no Venom log call since, ask once for
    // another pass to log it. This hook needs conversation access.
    api.on("before_agent_finalize", (event, ctx) => {
      if (event?.stopHookActive) return;
      const key = keyOf(event, ctx);
      if (!key || isSubagentSession(key)) return;
      const text = state.stopNote(key);
      if (!text) return;
      return {
        action: "revise",
        reason: text,
        retry: { instruction: text, idempotencyKey: `venom:stop:${key}`, maxAttempts: 1 },
      };
    });
  },
};
