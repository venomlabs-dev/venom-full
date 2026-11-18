// The shared hook script every shell-hook agent package carries.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(root, "shared/venom-hook.sh");
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));

function hook(event, payload, tmp, env = {}) {
  const run = spawnSync("sh", [SCRIPT, event], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { PATH: process.env.PATH, TMPDIR: tmp, ...env },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-hook-test-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("every copy and the texts block match shared/guidance.json", () => {
  execFileSync(process.execPath, [join(root, "scripts/sync-shared.mjs"), "--check"], { stdio: "pipe" });
});

test("fixed events print their text on one line", () =>
  withTmp((tmp) => {
    assert.equal(hook("session-start", {}, tmp), guidance.session_start);
    assert.equal(hook("pre-compact", {}, tmp), guidance.pre_compact);
    assert.equal(hook("compacted", {}, tmp), guidance.compacted);
    assert.equal(hook("subagent", {}, tmp), guidance.subagent);
    assert.equal(hook("unknown-event", {}, tmp), "");
  }));

const milestoneText = (kind) => guidance.milestone.replace("{what}", guidance.milestones[kind]);
const stopText = (kind) => guidance.stop.replace("{what}", guidance.milestones[kind]);
const shell = (session, command) => ({ session_id: session, tool_name: "Bash", tool_input: { command } });

test("milestones in shell commands, outcomes first, quoted text ignored", () =>
  withTmp((tmp) => {
    assert.equal(hook("post-tool", shell("a", "npm test && git commit -m \"wip\""), tmp), milestoneText("commit"));
    assert.equal(hook("post-tool", shell("b", "git push origin main && gh pr merge 3 --squash"), tmp), milestoneText("merge"));
    assert.equal(hook("post-tool", shell("c", "git -C /repo push"), tmp), milestoneText("push"));
    assert.equal(hook("post-tool", shell("d", "gh pr create --fill"), tmp), milestoneText("pr"));
    assert.equal(hook("post-tool", shell("e", "npx vercel deploy --prod"), tmp), milestoneText("deploy"));
    assert.equal(hook("post-tool", shell("f", "terraform apply -auto-approve"), tmp), milestoneText("deploy"));
    assert.equal(hook("post-tool", shell("g", "npm publish"), tmp), milestoneText("publish"));
    assert.equal(hook("post-tool", shell("h", "echo \"git push\" && grep 'gh pr merge' x"), tmp), "");
    assert.equal(hook("post-tool", shell("i", "git status"), tmp), "");
    assert.equal(hook("post-tool", { session_id: "j", tool_name: "Read" }, tmp), "");
  }));

test("a milestone is said once per 5 minutes per session", () =>
  withTmp((tmp) => {
    assert.equal(hook("post-tool", shell("s", "git commit -m x"), tmp), milestoneText("commit"));
    assert.equal(hook("post-tool", shell("s", "git commit --amend"), tmp), "");
    assert.equal(hook("post-tool", shell("other", "git commit -m x"), tmp), milestoneText("commit"));
  }));

test("stop asks once after an outcome with no Venom log after it", () =>
  withTmp((tmp) => {
    hook("post-tool", shell("s", "gh pr merge 4"), tmp);
    assert.equal(hook("stop", { session_id: "s" }, tmp), stopText("merge"));
    assert.equal(hook("stop", { session_id: "s" }, tmp), "");
    hook("post-tool", shell("t", "gh release create v1"), tmp);
    assert.equal(hook("stop", { session_id: "t", stop_hook_active: true }, tmp), "");
  }));

test("a Venom log clears the stop question; a commit alone never asks", () =>
  withTmp((tmp) => {
    hook("post-tool", shell("s", "gh pr merge 4"), tmp);
    hook("post-tool", { session_id: "s", tool_name: "mcp__venom__append_task_log" }, tmp);
    assert.equal(hook("stop", { session_id: "s" }, tmp), "");
    hook("post-tool", shell("c", "git commit -m x"), tmp);
    assert.equal(hook("stop", { session_id: "c" }, tmp), "");
  }));

test("JSON that escapes & < > as \\u0026 \\u003c \\u003e still finds milestones", () =>
  withTmp((tmp) => {
    const payload = '{"session_id":"u","tool_input":{"command":"cd app \\u0026\\u0026 git push"}}';
    assert.equal(hook("post-tool", payload, tmp), milestoneText("push"));
  }));

test("commands after env assignments, sudo, if/then, braces and gh global flags count", () =>
  withTmp((tmp) => {
    assert.equal(hook("post-tool", shell("p1", "HUSKY=0 git commit -m x"), tmp), milestoneText("commit"));
    assert.equal(hook("post-tool", shell("p2", "sudo git push"), tmp), milestoneText("push"));
    assert.equal(hook("post-tool", shell("p3", "if true; then git push; fi"), tmp), milestoneText("push"));
    assert.equal(hook("post-tool", shell("p4", "{ git push; }"), tmp), milestoneText("push"));
    assert.equal(hook("post-tool", shell("p5", "gh -R o/r pr merge 3"), tmp), milestoneText("merge"));
    assert.equal(hook("post-tool", shell("p6", "gh --repo o/r release create v1"), tmp), milestoneText("release"));
  }));

test("dry runs, help pages and heredoc bodies are not milestones", () =>
  withTmp((tmp) => {
    assert.equal(hook("post-tool", shell("d1", "git push --dry-run"), tmp), "");
    assert.equal(hook("post-tool", shell("d2", "gh pr merge --help"), tmp), "");
    assert.equal(hook("post-tool", shell("d3", "cat <<EOF > notes.md\ngit push\nEOF"), tmp), "");
  }));

test("only the tool name counts as a Venom log call, not text in a command", () =>
  withTmp((tmp) => {
    hook("post-tool", shell("l", "gh pr merge 1"), tmp);
    hook("post-tool", shell("l", "grep append_task_log notes.txt"), tmp);
    assert.equal(hook("stop", { session_id: "l" }, tmp), stopText("merge"));
  }));

test("an outcome more than an hour old isn't asked about", () =>
  withTmp((tmp) => {
    hook("post-tool", shell("old", "gh pr merge 1"), tmp);
    const uid = execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
    execFileSync("touch", ["-t", "202001010000", join(tmp, `venom-hooks-${uid}`, "old.pending")]);
    assert.equal(hook("stop", { session_id: "old" }, tmp), "");
  }));

test("hooks stay quiet when the state folder isn't the user's own", () =>
  withTmp((tmp) => {
    const uid = execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
    execFileSync("ln", ["-s", tmp, join(tmp, `venom-hooks-${uid}`)]);
    assert.equal(hook("post-tool", shell("x", "git push"), tmp), "");
    assert.equal(hook("session-start", {}, tmp), guidance.session_start);
  }));

test("wrappers can pass what they parsed", () =>
  withTmp((tmp) => {
    const env = { VENOM_HOOK_SESSION: "w", VENOM_HOOK_COMMAND: "git push" };
    assert.equal(hook("post-tool", "{}", tmp, env), milestoneText("push"));
  }));

test("texts are safe in JSON strings as they are", () => {
  for (const key of ["session_start", "pre_compact", "compacted", "subagent", "milestone", "stop"]) {
    assert.doesNotMatch(guidance[key], /["\\$`\n]/, key);
  }
});
