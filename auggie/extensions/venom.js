// Venom session guidance for Auggie 1.x. Auggie hooks cannot put text in front
// of the model at session start (SessionStart output is not added to context),
// so this small extension does it. Auggie 1.x loads pi-style extensions from
// packages (package.json "pi.extensions"). It reads the shared texts from
// ../guidance.json (copied by scripts/sync-shared.mjs --json auggie) and adds:
//   - first prompt of a session: find the Venom task, check mentions, log;
//   - in a subagent session: report to the parent instead of writing;
//   - after compaction: re-read the task (queued for the next prompt).
// The milestone notes after commits, PRs and deploys come from the plugin's
// PostToolUse hook (hooks/hooks.json), not from here. Never fails the agent.
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

export default function venom(pi, signedIn = (session) => signedInText(session, "auggie")) {
  let greet = true; // say the session-start text on the next prompt
  let extra = null; // what the sign-in adds, fetched at session start: { text, ready }

  pi.on("session_start", (event) => {
    // A resumed or reloaded session already has the text in its history.
    greet = event.reason === "startup" || event.reason === "new" || event.reason === "fork";
    if (!greet) return;
    // Fetched now, so the first prompt rarely waits; if it isn't back by
    // then, it comes with the next prompt.
    const fetched = { text: "", ready: false };
    extra = fetched;
    signedIn(event.sessionId).then(
      (text) => Object.assign(fetched, { text, ready: true }),
      () => Object.assign(fetched, { ready: true }),
    );
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (event.messageType === "custom") return;
    // A subagent reports to its parent: no projects or mentions for it.
    if (ctx?.role === "subagent") extra = null;
    const parts = [];
    if (greet) {
      greet = false;
      parts.push(ctx?.role === "subagent" ? guidance.subagent : guidance.session_start);
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
}
