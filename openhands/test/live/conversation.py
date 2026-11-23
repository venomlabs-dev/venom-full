"""One OpenHands conversation with Venom Full installed, for run.sh.

    python conversation.py <model-port> <repo> <route> <package>

route says how the package got to OpenHands:
  folder     run.sh copied it to ~/.openhands/plugins/venom-full (a local plugin)
  installed  install_plugin() from the package folder, as Agent Canvas does
  github     install_plugin("github:venomlabs-dev/venom-full", repo_path="openhands")

The conversation gives no plugin itself: OpenHands loads installed and local
plugins into every conversation, which is what this checks.
"""

import sys

from openhands.sdk import LLM, Agent, Conversation
from openhands.sdk.plugin import install_plugin
from openhands.sdk.tool import Tool
from openhands.tools.terminal import TerminalTool

port, repo, route, package = sys.argv[1:5]

if route == "installed":
    info = install_plugin(source=package)
    print(f"INSTALLED: {info.name} {info.version}")
elif route == "github":
    info = install_plugin(
        source="github:venomlabs-dev/venom-full", ref="main", repo_path="openhands"
    )
    print(f"INSTALLED: {info.name} {info.version}")

llm = LLM(
    model="openai/mock-model",
    base_url=f"http://127.0.0.1:{port}/v1",
    api_key="stand-in",
    usage_id="agent",
    num_retries=0,
)
agent = Agent(llm=llm, tools=[Tool(name=TerminalTool.name)])
conversation = Conversation(agent=agent, workspace=repo, max_iteration_per_run=8)
conversation.send_message("Merge the work.")
conversation.run()

context = conversation.agent.agent_context
print("SKILLS:", sorted(s.name for s in (context.skills if context else [])))
print("MCP:", sorted((conversation.agent.mcp_config or {}).keys()))
