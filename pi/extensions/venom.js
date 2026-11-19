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
// Signed in (sh hooks/venom-hook.sh login), the first prompt also brings the
// person's Venom projects and unread mentions, through the shared script.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const guidance = JSON.parse(readFileSync(new URL("../guidance.json", import.meta.url), "utf8"));

const CORE = fileURLToPath(new URL("../hooks/venom-hook.sh", import.meta.url));

/** What Venom's sign-in adds at session start (`venom-hook.sh session-extra`):
 * the person's projects and unread mentions, or how to sign in. "" on any
 * failure; the script caps its own wait at about 3 seconds. */
export function signedInText(session, agent) {
  return new Promise((done) => {
    try {
      const child = execFile(
        "sh",
        [CORE, "session-extra"],
        {
          timeout: 5000,
          env: { ...process.env, VENOM_HOOK_FORMAT: "text", VENOM_HOOK_SESSION: String(session || ""), VENOM_HOOK_AGENT: agent },
        },
        (error, stdout) => done(error ? "" : String(stdout).trim()),
      );
      child.stdin?.end();
    } catch {
      done("");
    }
  });
}

// A command starts after a separator, then optional VAR=value assignments and
// sudo, time, then, do, else, exec, nohup, command or ! (as in the shared script).
const START = String.raw`(?:^|[;&|({]\s*)(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S*|sudo|time|then|do|else|exec|nohup|command|!)\s+)*`;
const GIT = START + String.raw`git\s+(?:-[Cc]\s+\S+\s+|-\S+\s+)*`;
const GH = START + String.raw`gh\s+(?:(?:-R\s*\S+|--repo[= ]\S+)\s+)*`;
const END = String.raw`(?=\s|[;&|)}]|$)`;
const PATTERNS = {
  commit: GIT + String.raw`commit` + END,
  push: GIT + String.raw`push` + END,
  pr: GH + String.raw`pr\s+create` + END,
  merge: GH + String.raw`pr\s+merge` + END,
  release: GH + String.raw`release\s+create` + END,
  issue: GH + String.raw`issue\s+close` + END,
  workflow: GH + String.raw`workflow\s+run` + END,
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
const STOP_EXPIRY_MINUTES = 60;

/** The milestone a shell command reaches, or null. Quoted text is data. */
export function milestone(command) {
  if (typeof command !== "string") return null;
  // A heredoc body is data; a dry run or a help page is not a milestone.
  const line = command
    .split("<<")[0]
    .replace(/"(?:[^"\\]|\\.)*"/g, "")
    .replace(/'[^']*'/g, "")
    .replace(/\n/g, ";")
    .trim();
  if (/--dry-run|--help/.test(line)) return null;
  return MILESTONES.find(([, pattern]) => pattern.test(line))?.[0] ?? null;
}

const what = (kind) => guidance.milestones[kind] ?? "you finished a step";
export const milestoneText = (kind) => guidance.milestone.replace("{what}", what(kind));
export const stopText = (kind) => guidance.stop.replace("{what}", what(kind));

function textOf(content) {
  return Array.isArray(content) ? content.map((c) => (c?.type === "text" ? c.text : "")).join(" ") : "";
}

export default function venom(pi, now = () => Date.now(), signedIn = (session) => signedInText(session, "pi")) {
  let greet = true; // say the session-start text on the next prompt
  let extra = null; // what the sign-in adds, fetched at session start: { text, ready }
  const seen = new Map(); // "session:kind" -> time the milestone was last said
  const pending = new Map(); // session -> [outcome kind, time] awaiting a Venom log call
  const lastStop = new Map(); // session -> time the stop question was last asked
  const sid = (ctx) => {
    try {
      return ctx?.sessionManager?.getSessionId?.() ?? "session";
    } catch {
      return "session";
    }
  };

  pi.on("session_start", (event, ctx) => {
    // A resumed or reloaded session already has the text in its history.
    greet = event.reason === "startup" || event.reason === "new" || event.reason === "fork";
    if (!greet) return;
    // Fetched now, so the first prompt rarely waits; if it isn't back by
    // then, it comes with the next prompt.
    const fetched = { text: "", ready: false };
    extra = fetched;
    signedIn(sid(ctx)).then(
      (text) => Object.assign(fetched, { text, ready: true }),
      () => Object.assign(fetched, { ready: true }),
    );
  });

  pi.on("before_agent_start", (event) => {
    if (event.messageType === "custom") return;
    const parts = [];
    if (greet) {
      greet = false;
      parts.push(guidance.session_start);
    }
    if (extra?.ready) {
      if (extra.text) parts.push(extra.text);
      extra = null;
    }
    if (parts.length) return { message: { customType: "venom", content: parts.join("\n\n"), display: false } };
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
    if (guidance.stop_kinds.includes(kind)) pending.set(session, [kind, now()]);
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
    const [kind, at] = pending.get(session) ?? [];
    if (!kind) return;
    pending.delete(session);
    if (now() - at > STOP_EXPIRY_MINUTES * MIN) return; // an outcome from long ago isn't "this turn"
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
