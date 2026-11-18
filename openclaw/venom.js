// The Venom guidance logic for OpenClaw, kept apart from the plugin entry so it
// can be tested without OpenClaw. The texts and limits come from guidance.json
// (copied from shared/guidance.json by scripts/sync-shared.mjs): the same
// texts Claude Code and Codex get from the Venom server's get_guidance tool.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const guidance = JSON.parse(readFileSync(join(here, "guidance.json"), "utf8"));

const MINUTE = 60 * 1000;
const STOP_EXPIRY_MINUTES = 60;
const fill = (template, kind) => template.replace("{what}", guidance.milestones[kind]);
export const milestoneText = (kind) => fill(guidance.milestone, kind);
export const stopText = (kind) => fill(guidance.stop, kind);

// Quoted strings are data (a commit message that says "git push" is not a
// push), and line breaks separate commands.
function stripQuotes(command) {
  return command
    .split("<<")[0] // a heredoc body is data
    .replace(/\\"([^"\\]|\\[^"])*\\"/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/'[^']*'/g, "")
    .replace(/\r?\n/g, ";");
}

// Each subcommand of a shell line is checked, so "npm test && git push" counts.
// A command starts after a separator, then optional VAR=value assignments and
// sudo, time, then, do, else, exec, nohup, command or ! (as in the shared script).
const S = String.raw`(?:^|[;&|({]\s*)(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S*|sudo|time|then|do|else|exec|nohup|command|!)\s+)*`;
const G = S + String.raw`git(?:\s+(?:-[Cc]\s+\S+|-\S+))*\s+`;
const H = S + String.raw`gh(?:\s+(?:-R\s*\S+|--repo[= ]\S+))*\s+`;
const E = String.raw`(?:\s|[;&|)]|$)`;
const PATTERNS = {
  commit: new RegExp(`${G}commit${E}`),
  push: new RegExp(`${G}push${E}`),
  pr: new RegExp(`${H}pr\\s+create${E}`),
  merge: new RegExp(`${H}pr\\s+merge${E}`),
  release: new RegExp(`${H}release\\s+create${E}`),
  issue: new RegExp(`${H}issue\\s+close${E}`),
  workflow: new RegExp(`${H}workflow\\s+run${E}`),
  deploy: new RegExp(
    `${S}(?:npx\\s+)?(?:(?:vercel|netlify|fly|flyctl|firebase|wrangler|cdk|serverless|sls)\\s+(?:[^;&|]*\\s)?deploy${E}` +
      `|vercel\\s+(?:[^;&|]*\\s)?--prod${E})` +
      `|${S}(?:terraform\\s+apply|kubectl\\s+apply|helm\\s+upgrade)${E}`,
  ),
  publish: new RegExp(
    `${S}(?:(?:npm|pnpm|yarn|cargo)\\s+publish|docker\\s+push|twine\\s+upload)${E}`,
  ),
};
// Outcomes outrank the steps to them: "git push && gh pr merge" is a merge.
const ORDER = ["merge", "release", "workflow", "deploy", "publish", "commit", "push", "pr", "issue"];

/** The milestone a shell command reaches, or null. */
export function milestone(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  const line = stripQuotes(command);
  if (/--dry-run|--help/.test(line)) return null;
  return ORDER.find((kind) => PATTERNS[kind].test(line)) ?? null;
}

export const isShellTool = (name) => ["exec", "bash", "shell"].includes(String(name).toLowerCase());
export const isVenomLogTool = (name) => /append_task_log|append_project_log|edit_log_entry/.test(String(name));
export const isSubagentSession = (key) => typeof key === "string" && /(^|:)subagent:/.test(key);

/** Per-process memory of what each session has been told. */
export function createState(now = () => Date.now()) {
  const started = new Set();
  const subagents = new Set();
  const lastMilestone = new Map();
  const pending = new Map();
  const lastStop = new Map();
  return {
    /** True the first time a main session is seen; subagents never get the session start text. */
    takeStart(key) {
      if (!key || subagents.has(key) || isSubagentSession(key) || started.has(key)) return false;
      started.add(key);
      return true;
    },
    /** A subagent by session-key pattern or because subagent_spawned named it. */
    isSubagent(key) {
      return subagents.has(key) || isSubagentSession(key);
    },
    markSubagent(key) {
      if (key) subagents.add(key);
    },
    /** The milestone note for a shell command, or null; remembers an outcome for the stop question. */
    milestoneNote(key, command) {
      const kind = milestone(command);
      if (!kind) return null;
      if (guidance.stop_kinds.includes(kind)) pending.set(key, [kind, now()]);
      const id = `${key}:${kind}`;
      const last = lastMilestone.get(id);
      if (last !== undefined && now() - last < guidance.milestone_gap_minutes * MINUTE) return null;
      lastMilestone.set(id, now());
      return milestoneText(kind);
    },
    /** A Venom log call came after the outcome: no stop question. */
    logged(key) {
      pending.delete(key);
    },
    /** The stop question, once per outcome and at most every stop_gap_minutes; null if none. */
    stopNote(key) {
      const [kind, at] = pending.get(key) ?? [];
      if (!kind) return null;
      pending.delete(key);
      if (now() - at > STOP_EXPIRY_MINUTES * MINUTE) return null; // an outcome from long ago isn't "this turn"
      const last = lastStop.get(key);
      if (last !== undefined && now() - last < guidance.stop_gap_minutes * MINUTE) return null;
      lastStop.set(key, now());
      return stopText(kind);
    },
  };
}
