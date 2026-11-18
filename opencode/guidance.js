// Venom guidance for OpenCode, matched to the texts the Venom server's
// get_guidance tool returns to Claude Code and Codex hooks
// (services/mcp/src/guidance.py in the Venom monorepo). OpenCode plugins can't
// call an MCP tool, so the plugin carries the event texts itself; the server's
// instructions and tool-response reminders still reach OpenCode as usual.

export const MCP_URL = "https://mcp.venomlabs.dev";

export const SESSION_START =
  "Venom: before your first reply about the team's work, find the Venom " +
  "project and task it belongs to (search with a few keywords, or " +
  "list_projects and read_task) and check list_mentions. If it is new work " +
  "to build or change something and no task matches, create one first. " +
  "Before your final reply, log decisions, outcomes and next steps to that task.";

export const PRE_COMPACT =
  "In the summary, keep the Venom project and task refs being worked on, any " +
  "decisions not yet logged to Venom, and unanswered Venom mentions.";

export const COMPACTED =
  "Venom: context was compacted. If you were working on a Venom task, re-read " +
  "it with read_task before continuing. Log any decisions from before " +
  "compaction that are not in Venom yet.";

export const SUBAGENT =
  "Venom: you are a subagent. Read Venom if it helps your assignment, but do " +
  "not write to it. Put decisions, findings and blockers in your final report " +
  "so your parent can log them. Exception: if your parent gave you a Venom " +
  "task to own, log to that task.";

const MILESTONE_TEXT = {
  commit: "you committed",
  push: "you pushed",
  pr: "you opened a pull request",
  merge: "you merged a pull request",
  release: "you created a release",
  issue: "you closed an issue",
  workflow: "you started a GitHub workflow",
  deploy: "you deployed",
  publish: "you published a package or image",
};

// Each subcommand of a shell line is checked, so "npm test && git push" counts.
const START = String.raw`(?:^|[;&|(]\s*)`;
const GIT = START + String.raw`git\s+(?:-[Cc]\s+\S+\s+|-\S+\s+)*`;
const MILESTONES = [
  ["commit", new RegExp(GIT + String.raw`commit\b`)],
  ["push", new RegExp(GIT + String.raw`push\b`)],
  ["pr", new RegExp(START + String.raw`gh\s+pr\s+create\b`)],
  ["merge", new RegExp(START + String.raw`gh\s+pr\s+merge\b`)],
  ["release", new RegExp(START + String.raw`gh\s+release\s+create\b`)],
  ["issue", new RegExp(START + String.raw`gh\s+issue\s+close\b`)],
  ["workflow", new RegExp(START + String.raw`gh\s+workflow\s+run\b`)],
  [
    "deploy",
    new RegExp(
      START +
        String.raw`(?:npx\s+)?(?:vercel|netlify|fly|flyctl|firebase|wrangler|cdk|serverless|sls)\s+(?:\S+\s+)*?deploy\b` +
        "|" +
        START +
        String.raw`(?:npx\s+)?vercel\s+(?:\S+\s+)*?--prod\b` +
        "|" +
        START +
        String.raw`(?:terraform\s+apply|kubectl\s+apply|helm\s+upgrade)\b`,
    ),
  ],
  [
    "publish",
    new RegExp(
      START + String.raw`(?:(?:npm|pnpm|yarn|cargo)\s+publish|docker\s+push|twine\s+upload)\b`,
    ),
  ],
];
// Outcomes outrank the steps to them: "git push && gh pr merge" is a merge.
const OUTCOMES = new Set(["merge", "release", "workflow", "deploy", "publish"]);

/** The milestone a shell command reaches, or null. */
export function milestone(command) {
  if (typeof command !== "string") return null;
  const line = command.trim();
  const found = MILESTONES.filter(([, pattern]) => pattern.test(line)).map(([kind]) => kind);
  return found.find((kind) => OUTCOMES.has(kind)) ?? found[0] ?? null;
}

export function milestoneText(kind) {
  return (
    `Venom milestone: ${MILESTONE_TEXT[kind]}. If this advances a Venom task, ` +
    "log the outcome with evidence (commit or PR link) and the next step, and " +
    "update the status if it changed. A commit, push or PR alone does not make " +
    "a task done unless the task says so."
  );
}

// Outcome-type milestones that earn one end-of-turn question when nothing was
// logged to Venom after them.
const STOP_KINDS = new Set(["merge", "release", "workflow", "deploy", "publish"]);

export function stopText(kind) {
  return (
    `Venom: ${MILESTONE_TEXT[kind] ?? "you finished a step"} this turn and nothing was ` +
    "logged to Venom after it. If it produced a decision, outcome, blocker or " +
    "next step a teammate would need, log it to the Venom task now, with the " +
    "commit, PR or deploy as evidence. If the work isn't at a point worth " +
    "recording yet, don't log anything; just finish your reply."
  );
}

/** True for a Venom log tool, however the host spells its name (venom_append_task_log, ...). */
export function isLogTool(name) {
  return typeof name === "string" && /append_task_log|append_project_log|edit_log_entry/.test(name);
}

// The server says each milestone at most once per type every 5 minutes per
// session; the plugin keeps the same limit.
const MILESTONE_GAP_MS = 5 * 60 * 1000;
// The stop question is asked at most once every 15 minutes per session.
const STOP_GAP_MS = 15 * 60 * 1000;

/** Per-process memory of what each session has been told. */
export function createState(now = () => Date.now()) {
  const compacted = new Set();
  const lastMilestone = new Map();
  const parents = new Map();
  const pendingStop = new Map();
  const lastStop = new Map();
  return {
    /** Remember an outcome milestone that no Venom log has followed yet. */
    notePending(sessionID, command) {
      const kind = milestone(command);
      if (sessionID && kind && STOP_KINDS.has(kind)) pendingStop.set(sessionID, kind);
    },
    /** A Venom log call came after the milestone: nothing to ask. */
    clearPending(sessionID) {
      pendingStop.delete(sessionID);
    },
    /** The end-of-turn question text, once, or null. */
    stopQuestion(sessionID) {
      const kind = pendingStop.get(sessionID);
      if (!kind) return null;
      pendingStop.delete(sessionID);
      const last = lastStop.get(sessionID);
      if (last !== undefined && now() - last < STOP_GAP_MS) return null;
      lastStop.set(sessionID, now());
      return stopText(kind);
    },
    markCompacted(sessionID) {
      if (sessionID) compacted.add(sessionID);
    },
    /** True once after compaction, then false until the next one. */
    takeCompacted(sessionID) {
      return compacted.delete(sessionID);
    },
    /** The milestone note for a shell command, or null if none or said recently. */
    milestoneNote(sessionID, command) {
      const kind = milestone(command);
      if (!kind) return null;
      const key = `${sessionID ?? ""}:${kind}`;
      const last = lastMilestone.get(key);
      if (last !== undefined && now() - last < MILESTONE_GAP_MS) return null;
      lastMilestone.set(key, now());
      return milestoneText(kind);
    },
    /** Whether a session is a subagent's, with the lookup cached per session. */
    async isSubagent(sessionID, lookupParent) {
      if (!sessionID) return false;
      if (!parents.has(sessionID)) {
        try {
          parents.set(sessionID, (await lookupParent(sessionID)) ?? null);
        } catch {
          // Unknown this time: ask again on the next request instead of caching.
          return false;
        }
      }
      return Boolean(parents.get(sessionID));
    },
  };
}

/** True when a configured MCP server already points at Venom. */
export function hasVenom(servers) {
  if (!servers) return false;
  const entries = Array.isArray(servers) ? servers : Object.entries(servers);
  return entries.some(([name, config]) => {
    const url = typeof config?.url === "string" ? config.url.replace(/\/+$/, "") : "";
    return name === "venom" || url === MCP_URL;
  });
}

export function isShellTool(name) {
  return name === "bash" || name === "shell";
}
