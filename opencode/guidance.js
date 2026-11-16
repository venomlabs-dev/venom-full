// Venom guidance for OpenCode, matched to the texts the Venom server's
// get_guidance tool returns to Claude Code and Codex hooks
// (services/mcp/src/guidance.py in the Venom monorepo). OpenCode plugins can't
// call an MCP tool, so the plugin carries the event texts itself; the server's
// instructions and tool-response reminders still reach OpenCode as usual.

export const MCP_URL = "https://mcp.venomlabs.dev";

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

// The server says each milestone at most once per type every 5 minutes per
// session; the plugin keeps the same limit.
const MILESTONE_GAP_MS = 5 * 60 * 1000;

/** Per-process memory of what each session has been told. */
export function createState(now = () => Date.now()) {
  const compacted = new Set();
  const lastMilestone = new Map();
  const parents = new Map();
  return {
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
        let parent = null;
        try {
          parent = (await lookupParent(sessionID)) ?? null;
        } catch {
          parent = null;
        }
        parents.set(sessionID, parent);
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
