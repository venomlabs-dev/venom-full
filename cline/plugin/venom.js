// Venom for the Cline CLI: tells the agent where to look before its first reply.
//
// File hooks cannot do this in the CLI (TaskStart runs without a way to add
// context there), but a plugin's beforeRun hook can. One self-contained file,
// so it installs straight from GitHub:
//   cline plugin install https://github.com/venomlabs-dev/venom-full/blob/main/cline/plugin/venom.js
// The texts match shared/guidance.json (a test checks it). Milestone reminders
// come from the PostToolUse hook file; see ../README.md.

const SESSION_START = "Venom: before your first reply about the team's work, find the Venom project and task it belongs to (search with a few keywords, or list_projects and read_task) and check list_mentions. If it is new work to build or change something and no task matches, create one first. Before your final reply, log decisions, outcomes and next steps to that task.";
const SUBAGENT = "Venom: you are a subagent. Read Venom if it helps your assignment, but do not write to it. Put decisions, findings and blockers in your final report so your parent can log them. Exception: if your parent gave you a Venom task to own, log to that task.";

let said = false;

const plugin = {
  name: "venom",
  manifest: { capabilities: ["hooks"] },
  setup() {},
  hooks: {
    // Runs before every turn; the note goes in once per session, as the
    // subagent note when the run belongs to a subagent.
    beforeRun(context) {
      if (said) return undefined;
      said = true;
      const parent = context && context.snapshot && context.snapshot.parentAgentId;
      return { appendContext: parent ? SUBAGENT : SESSION_START };
    },
  },
};

export default plugin;
