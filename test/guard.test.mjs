// Claude Code and Codex keep their mcp_tool hooks, which call Venom's server
// for projects and mentions. Nothing the other agents' packages add may reach
// them: Claude Code and Codex load a plugin's manifest hooks, hooks/hooks.json,
// and root skills/, commands/, agents/ and .mcp.json.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));

function hookTypes(file) {
  const types = [];
  for (const groups of Object.values(json(file).hooks)) {
    for (const group of groups) for (const hook of group.hooks) types.push(hook.type);
  }
  return types;
}

test("Claude Code and Codex manifests point at their own mcp_tool hooks only", () => {
  assert.equal(json(".claude-plugin/plugin.json").hooks, "./hooks/claude-hooks.json");
  assert.equal(json(".codex-plugin/plugin.json").hooks, "./hooks/codex-hooks.json");
  for (const file of ["hooks/claude-hooks.json", "hooks/codex-hooks.json"]) {
    const types = hookTypes(file);
    assert.ok(types.length > 0, file);
    assert.deepEqual([...new Set(types)], ["mcp_tool"], `${file} must hold only mcp_tool hooks`);
  }
});

test("nothing at the plugin root that Claude Code or Codex would load", () => {
  for (const path of ["hooks/hooks.json", ".mcp.json", "skills", "commands", "agents", "gemini-extension.json"]) {
    assert.equal(existsSync(join(root, path)), false, `${path} at the repository root reaches Claude Code or Codex`);
  }
});

test("every package manifest carries the same version as Claude Code's", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const want = json(".claude-plugin/plugin.json").version;
  const names = /^(plugin\.json|package\.json|.*-extension\.json|kimi\.plugin\.json|openclaw\.plugin\.json|extension\.json)$/;
  const seen = [];
  const walk = (dir, depth) => {
    for (const entry of readdirSync(join(root, dir))) {
      if (entry === "node_modules" || entry === ".git") continue;
      const rel = dir ? `${dir}/${entry}` : entry;
      if (statSync(join(root, rel)).isDirectory()) {
        if (depth < 3) walk(rel, depth + 1);
      } else if (names.test(entry) && !entry.endsWith("marketplace.json")) {
        const version = json(rel).version;
        if (version !== undefined) seen.push([rel, version]);
      }
    }
  };
  walk("", 0);
  assert.ok(seen.length > 10, `found only ${seen.length} manifests`);
  for (const [file, version] of seen) assert.equal(version, want, file);
});
