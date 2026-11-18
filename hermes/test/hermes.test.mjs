import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const python = ["python3", "python"].find((cmd) => spawnSync(cmd, ["--version"]).status === 0);

test("python unit tests pass", { skip: python ? false : "python is not installed" }, () => {
  const run = spawnSync(python, ["-m", "unittest", "discover", join(root, "test")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});

test("manifest and guidance ship with the plugin", () => {
  const manifest = readFileSync(join(root, "plugin.yaml"), "utf8");
  assert.match(manifest, /^name: venom$/m);
  for (const hook of ["pre_llm_call", "post_tool_call", "transform_tool_result", "pre_verify", "post_compaction"]) {
    assert.match(manifest, new RegExp(`- ${hook}$`, "m"));
  }
  assert.ok(existsSync(join(root, "__init__.py")));
  const guidance = JSON.parse(readFileSync(join(root, "guidance.json"), "utf8"));
  assert.ok(guidance.session_start && guidance.stop && guidance.milestone);
});
