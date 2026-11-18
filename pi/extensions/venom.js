// Venom hooks for Pi (pi.dev). One extension, no build step: Pi loads it as is.
// It reads the shared texts from ../guidance.json (copied by
// scripts/sync-shared.mjs --json pi) and adds short Venom reminders to what
// the model sees:
//   - first prompt of a session: where to find the Venom task, and to log;
//   - after a shell tool call that commits, pushes, opens or merges a PR,
//     releases, deploys or publishes: a note appended to the tool result;
//   - after compaction: a note for the next prompt;
//   - once before the agent finishes, after a merge/release/workflow/deploy/
//     publish with no Venom log call after it: one more turn with a question.
// Pi has no built-in subagents (they are extensions that start another pi
// process), so there is no subagent text. Reminders never fail the agent.
import { readFileSync } from "node:fs";

const guidance = JSON.parse(readFileSync(new URL("../guidance.json", import.meta.url), "utf8"));

const START = String.raw`(?:^|[;&|(]\s*)`;
const GIT = START + String.raw`git\s+(?:-[Cc]\s+\S+\s+|-\S+\s+)*`;
const END = String.raw`(?=\s|[;&|)]|$)`;
const PATTERNS = {
  commit: GIT + String.raw`commit` + END,
  push: GIT + String.raw`push` + END,
  pr: START + String.raw`gh\s+pr\s+create` + END,
  merge: START + String.raw`gh\s+pr\s+merge` + END,
  release: START + String.raw`gh\s+release\s+create` + END,
  issue: START + String.raw`gh\s+issue\s+close` + END,
  workflow: START + String.raw`gh\s+workflow\s+run` + END,
  deploy:
    START +
    String.raw`(?:npx\s+)?(?:(?:vercel|netlify|fly|flyctl|firebase|wrangler|cdk|serverless|sls)\s+(?:[^;&|]*\s)?deploy|vercel\s+(?:[^;&|]*\s)?--prod)` +
    END +
    "|" +
    START +
    String.raw`(?:terraform\s+apply|kubectl\s+apply|helm\s+upgrade)` +
    END,
  publish:
    START + String.raw`(?:(?:npm|pnpm|yarn|cargo)\s+publish|docker\s+push|twine\s+upload)` + END,
};
// Same order as the shared shell script: outcomes first.
const ORDER = ["merge", "release", "workflow", "deploy", "publish", "commit", "push", "pr", "issue"];
const MILESTONES = ORDER.map((kind) => [kind, new RegExp(PATTERNS[kind])]);
const LOG_TOOLS = /append_task_log|append_project_log|edit_log_entry/;
const MIN = 60 * 1000;

/** The milestone a shell command reaches, or null. Quoted text is data. */
export function milestone(command) {
  if (typeof command !== "string") return null;
  const line = command
    .replace(/"(?:[^"\\]|\\.)*"/g, "")
    .replace(/'[^']*'/g, "")
    .replace(/\n/g, ";")
    .trim();
  return MILESTONES.find(([, pattern]) => pattern.test(line))?.[0] ?? null;
}

const what = (kind) => guidance.milestones[kind] ?? "you finished a step";
export const milestoneText = (kind) => guidance.milestone.replace("{what}", what(kind));
export const stopText = (kind) => guidance.stop.replace("{what}", what(kind));

function textOf(content) {
  return Array.isArray(content) ? content.map((c) => (c?.type === "text" ? c.text : "")).join(" ") : "";
}

export default function venom(pi, now = () => Date.now()) {
  let greet = true; // say the session-start text on the next prompt
  const seen = new Map(); // "session:kind" -> time the milestone was last said
  const pending = new Map(); // session -> outcome kind awaiting a Venom log call
  const lastStop = new Map(); // session -> time the stop question was last asked
  const sid = (ctx) => {
    try {
      return ctx?.sessionManager?.getSessionId?.() ?? "session";
    } catch {
      return "session";
    }
  };

  pi.on("session_start", (event) => {
    // A resumed or reloaded session already has the text in its history.
    greet = event.reason === "startup" || event.reason === "new" || event.reason === "fork";
  });

  pi.on("before_agent_start", (event) => {
    if (!greet || event.messageType === "custom") return;
    greet = false;
    return { message: { customType: "venom", content: guidance.session_start, display: false } };
  });

  pi.on("session_compact", () => {
    // The summary is already written; the model reads this with the next prompt.
    pi.sendMessage(
      { customType: "venom", content: guidance.compacted, display: false },
      { deliverAs: "nextTurn" },
    );
  });

  pi.on("tool_result", (event, ctx) => {
    const session = sid(ctx);
    if (LOG_TOOLS.test(event.toolName ?? "")) {
      pending.delete(session);
      return;
    }
    if (event.toolName !== "bash" || event.isError) return;
    const kind = milestone(event.input?.command);
    if (!kind) return;
    if (guidance.stop_kinds.includes(kind)) pending.set(session, kind);
    const key = `${session}:${kind}`;
    const last = seen.get(key);
    if (last !== undefined && now() - last < guidance.milestone_gap_minutes * MIN) return;
    seen.set(key, now());
    return {
      content: [...(event.content ?? []), { type: "text", text: `\n\n${milestoneText(kind)}` }],
    };
  });

  // The last chance before Pi goes idle: ask once, with one more turn.
  pi.on("agent_before_settle", (event, ctx) => {
    const session = sid(ctx);
    const kind = pending.get(session);
    if (!kind) return;
    pending.delete(session);
    const last = lastStop.get(session);
    if (last !== undefined && now() - last < guidance.stop_gap_minutes * MIN) return;
    lastStop.set(session, now());
    return {
      entries: [
        ...(event.entries ?? []),
        { type: "custom_message", customType: "venom", content: stopText(kind), display: false },
      ],
      continue: true,
    };
  });
}
