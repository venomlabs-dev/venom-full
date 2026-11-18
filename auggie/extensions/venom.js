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
import { readFileSync } from "node:fs";

const guidance = JSON.parse(readFileSync(new URL("../guidance.json", import.meta.url), "utf8"));

export default function venom(pi) {
  let greet = true; // say the session-start text on the next prompt

  pi.on("session_start", (event) => {
    // A resumed or reloaded session already has the text in its history.
    greet = event.reason === "startup" || event.reason === "new" || event.reason === "fork";
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!greet || event.messageType === "custom") return;
    greet = false;
    const content = ctx?.role === "subagent" ? guidance.subagent : guidance.session_start;
    return { message: { customType: "venom", content, display: false } };
  });

  pi.on("session_compact", () => {
    // The summary is already written; the model reads this with the next prompt.
    pi.sendMessage(
      { customType: "venom", content: guidance.compacted, display: false },
      { deliverAs: "nextTurn" },
    );
  });
}
