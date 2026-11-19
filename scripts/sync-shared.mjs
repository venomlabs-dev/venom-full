#!/usr/bin/env node
// Keeps every agent package's copy of the shared Venom hook pieces in step:
//
//   node scripts/sync-shared.mjs                 regenerate and update existing copies
//   node scripts/sync-shared.mjs cursor gemini   also add copies to those folders
//   node scripts/sync-shared.mjs --json pi       also add <folder>/guidance.json
//   node scripts/sync-shared.mjs --check         fail if anything is out of date
//
// shared/guidance.json holds the texts. They go into the texts block of
// shared/venom-hook.sh, which is copied to <folder>/hooks/venom-hook.sh, and
// guidance.json itself is copied to <folder>/guidance.json for agents whose
// plugins are code (TypeScript, Python) instead of shell hooks.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_SH = join(root, "shared/venom-hook.sh");
const SHARED_JSON = join(root, "shared/guidance.json");
const SKIP = new Set(["shared", "scripts", "test", "node_modules", ".git", "hooks", "assets"]);

const args = process.argv.slice(2);
const check = args.includes("--check");
const withJson = args.includes("--json");
const targets = args.filter((a) => !a.startsWith("--"));

const guidance = JSON.parse(readFileSync(SHARED_JSON, "utf8"));
const TEXT_KEYS = ["session_start", "pre_compact", "compacted", "subagent", "milestone", "stop"];

function assertSafe(name, text) {
  if (typeof text !== "string" || !text) throw new Error(`${name} is missing`);
  // Hook scripts put texts in JSON and in a sed replacement as they are.
  if (/["\\$`/&\x00-\x1f]/.test(text)) {
    throw new Error(`${name} has a double quote, backslash, dollar sign, backtick, slash, ampersand or control character`);
  }
}
for (const key of TEXT_KEYS) assertSafe(key, guidance[key]);
for (const [kind, text] of Object.entries(guidance.milestones)) assertSafe(`milestones.${kind}`, text);

// Each copy also names its agent (the folder), so the Venom server can count
// signed-in session starts per agent.
const block = (agent) =>
  [
    "# >>> texts: generated from shared/guidance.json by scripts/sync-shared.mjs",
    ...TEXT_KEYS.map((k) => `${k.toUpperCase()}="${guidance[k]}"`),
    ...Object.entries(guidance.milestones).map(([k, v]) => `WHAT_${k.toUpperCase()}="${v}"`),
    `STOP_KINDS="${guidance.stop_kinds.join(" ")}"`,
    `MILESTONE_GAP_MINUTES=${Number(guidance.milestone_gap_minutes)}`,
    `STOP_GAP_MINUTES=${Number(guidance.stop_gap_minutes)}`,
    `AGENT="${agent}"`,
    "# <<< texts",
  ].join("\n");

const current = readFileSync(SHARED_SH, "utf8");
const start = current.indexOf("# >>> texts");
const end = current.indexOf("# <<< texts") + "# <<< texts".length;
if (start < 0 || end < start) throw new Error("shared/venom-hook.sh has no texts block");
const scriptFor = (agent) => {
  if (!/^[a-z0-9-]*$/.test(agent)) throw new Error(`${agent} is not a folder name an agent can have`);
  return current.slice(0, start) + block(agent) + current.slice(end);
};
const script = scriptFor("");

const problems = [];
function write(file, content, mode) {
  const old = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (old === content) return;
  if (check) {
    problems.push(`${file.slice(root.length + 1)} is out of date: run node scripts/sync-shared.mjs`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (mode) chmodSync(file, mode);
}

write(SHARED_SH, script, 0o755);

const folders = readdirSync(root).filter(
  (d) => !d.startsWith(".") && !SKIP.has(d) && statSync(join(root, d)).isDirectory(),
);
for (const folder of folders) {
  const sh = join(root, folder, "hooks/venom-hook.sh");
  const json = join(root, folder, "guidance.json");
  if (existsSync(sh) || targets.includes(folder)) write(sh, scriptFor(folder), 0o755);
  if (existsSync(json) || (withJson && targets.includes(folder))) {
    write(json, readFileSync(SHARED_JSON, "utf8"));
  }
}
for (const t of targets) {
  if (!folders.includes(t) && !check) {
    write(join(root, t, "hooks/venom-hook.sh"), scriptFor(t), 0o755);
    if (withJson) write(join(root, t, "guidance.json"), readFileSync(SHARED_JSON, "utf8"));
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
