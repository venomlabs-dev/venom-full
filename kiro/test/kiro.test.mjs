// Runs the commands from the Kiro hook files, installed the way the README says.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guidance = JSON.parse(readFileSync(join(here, "../shared/guidance.json"), "utf8"));
const milestoneText = (k) => guidance.milestone.replace("{what}", guidance.milestones[k]);
const stopText = (k) => guidance.stop.replace("{what}", guidance.milestones[k]);

// scope: "workspace" installs into <project>/.kiro/hooks, "user" into $HOME/.kiro/hooks.
function setup(scope) {
  const root = mkdtempSync(join(tmpdir(), "venom-kiro-"));
  // Today's signed-out sign-in note is already given (shared/venom-hook.sh).
  mkdirSync(join(root, `venom-hooks-${process.getuid()}`), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, `venom-hooks-${process.getuid()}`, "nudged"), "");
  const home = join(root, "home");
  const project = join(root, "project");
  const dest = join(scope === "user" ? home : project, ".kiro/hooks");
  mkdirSync(join(dest, "venom"), { recursive: true });
  mkdirSync(project, { recursive: true });
  cpSync(join(here, "hooks/venom-hook.sh"), join(dest, "venom/venom-hook.sh"));
  cpSync(join(here, `hooks/venom-${scope}.json`), join(dest, "venom.json"));
  const file = JSON.parse(readFileSync(join(dest, "venom.json"), "utf8"));
  const run = (name, payload, cwd = project) => {
    const hook = file.hooks.find((h) => h.name === name);
    assert.ok(hook, name);
    const r = spawnSync("sh", ["-c", hook.action.command], {
      cwd,
      input: JSON.stringify(payload),
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: root },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  return { root, file, run, home };
}

const shell = (session, command) => ({
  hook_event_name: "PostToolUse", cwd: "/p", session_id: session, tool_name: "execute_bash", tool_input: { command },
});

for (const scope of ["workspace", "user"]) {
  test(`${scope}: file format`, () => {
    const { root, file } = setup(scope);
    try {
      assert.equal(file.version, "v1");
      const triggers = file.hooks.map((h) => h.trigger);
      assert.deepEqual(triggers, ["SessionStart", "PreCompaction", "PostCompaction", "PostToolUse", "PostToolUse", "Stop"]);
      for (const h of file.hooks) assert.equal(h.action.type, "command");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test(`${scope}: a missing hook script or a cwd outside the project is a quiet exit 0`, () => {
    const { root, run, home } = setup(scope);
    try {
      const start = { hook_event_name: "SessionStart", cwd: "/p", session_id: "s9" };
      const elsewhere = join(root, "elsewhere");
      mkdirSync(elsewhere);
      // The user-level command uses $HOME, so only the workspace one depends on cwd.
      const expected = scope === "user" ? guidance.session_start : "";
      assert.equal(run("venom-session-start", start, elsewhere), expected);
      rmSync(join(scope === "user" ? home : join(root, "project"), ".kiro/hooks/venom/venom-hook.sh"));
      assert.equal(run("venom-session-start", { ...start, session_id: "s10" }), "");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test(`${scope}: session start, compaction, milestone, stop, log clears stop`, () => {
    const { root, run } = setup(scope);
    try {
      const start = { hook_event_name: "SessionStart", cwd: "/p", session_id: "s1" };
      assert.equal(run("venom-session-start", start), guidance.session_start);
      assert.equal(run("venom-pre-compaction", { session_id: "s1" }), guidance.pre_compact);
      assert.equal(run("venom-post-compaction", { session_id: "s1", summary: "x" }), guidance.compacted);
      // milestone, then a non-milestone
      assert.equal(run("venom-milestone", shell("s1", "git commit -m \"wip\"")), milestoneText("commit"));
      assert.equal(run("venom-milestone", shell("s1", "git status")), "");
      // stop asks once after a merge
      assert.equal(run("venom-milestone", shell("s2", "gh pr merge 3 --squash")), milestoneText("merge"));
      assert.equal(run("venom-stop", { hook_event_name: "Stop", session_id: "s2" }), stopText("merge"));
      assert.equal(run("venom-stop", { hook_event_name: "Stop", session_id: "s2" }), "");
      // a Venom log clears it
      run("venom-milestone", shell("s3", "npm publish"));
      assert.equal(run("venom-log-clears-stop", { session_id: "s3", tool_name: "mcp_venom_append_task_log", tool_input: {} }), "");
      assert.equal(run("venom-stop", { session_id: "s3" }), "");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
