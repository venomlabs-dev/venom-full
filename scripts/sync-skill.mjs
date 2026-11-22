#!/usr/bin/env node
// Copies the venom skill from a checkout of venomlabs-dev/plugin (its source)
// into every package here that ships it: <folder>/skills/venom/SKILL.md.
//
//   node scripts/sync-skill.mjs [path-to-plugin-checkout]          update copies
//   node scripts/sync-skill.mjs [path-to-plugin-checkout] --check  fail if stale
//
// The path defaults to ../plugin next to this repository.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const plugin = resolve(args.find((a) => !a.startsWith("--")) ?? join(root, "../plugin"));
const source = join(plugin, "skills/venom/SKILL.md");
if (!existsSync(source)) {
  console.error(`No skill at ${source}: pass the path to a venomlabs-dev/plugin checkout.`);
  process.exit(1);
}
const skill = readFileSync(source, "utf8");

let stale = 0;
for (const folder of readdirSync(root).sort()) {
  const copy = join(root, folder, "skills/venom/SKILL.md");
  if (!existsSync(copy) || readFileSync(copy, "utf8") === skill) continue;
  stale += 1;
  if (check) console.log(`stale: ${folder}/skills/venom/SKILL.md`);
  else {
    writeFileSync(copy, skill);
    console.log(`updated: ${folder}/skills/venom/SKILL.md`);
  }
}
if (check && stale) process.exit(1);
