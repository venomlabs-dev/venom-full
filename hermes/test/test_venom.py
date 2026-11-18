import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("venom_hermes", ROOT / "__init__.py")
mod = importlib.util.module_from_spec(spec)
sys.modules["venom_hermes"] = mod
spec.loader.exec_module(mod)

G = mod.load_guidance()


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def minutes(self, n):
        self.t += n * 60


class FakeCtx:
    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, fn):
        self.hooks[name] = fn


def setup():
    clock = Clock()
    ctx = FakeCtx()
    mod.register(ctx, mod.Venom(G, clock))
    return ctx.hooks, clock


def shell(h, command, sid="s1", call="c1", status="ok"):
    h["post_tool_call"](tool_name="terminal", args={"command": command}, session_id=sid,
                        tool_call_id=call, status=status, result="{}")
    return h["transform_tool_result"](tool_name="terminal", args={"command": command},
                                      result=json.dumps({"output": "done", "exit_code": 0}),
                                      session_id=sid, tool_call_id=call)


class Milestones(unittest.TestCase):
    def test_patterns(self):
        m = mod.milestone
        self.assertEqual(m("git commit -m x"), "commit")
        self.assertEqual(m("npm test && git push origin main"), "push")
        self.assertEqual(m("git -C repo push"), "push")
        self.assertEqual(m("git push && gh pr merge 3 --squash"), "merge")
        self.assertEqual(m("gh pr create --fill"), "pr")
        self.assertEqual(m("npx vercel --prod"), "deploy")
        self.assertEqual(m("terraform apply -auto-approve"), "deploy")
        self.assertEqual(m("npm publish"), "publish")
        self.assertEqual(m("gh issue close 4"), "issue")
        self.assertIsNone(m("git status"))
        self.assertIsNone(m("echo git commit"))
        self.assertIsNone(m('git log --grep "git push"'))
        self.assertIsNone(m("git commit-tree abc"))
        self.assertIsNone(m(None))


class MilestoneRules(unittest.TestCase):
    def test_prefixes(self):
        m = mod.milestone
        self.assertEqual(m("CI=1 git push"), "push")
        self.assertEqual(m("sudo git commit -m x"), "commit")
        self.assertEqual(m("time git push"), "push")
        self.assertEqual(m("if true; then git push; fi"), "push")
        self.assertEqual(m("{ git commit -m x; }"), "commit")
        self.assertEqual(m("! git push"), "push")
        self.assertEqual(m("nohup npm publish"), "publish")
        self.assertEqual(m("FOO=bar BAZ=1 gh pr create"), "pr")

    def test_gh_repo_flags(self):
        self.assertEqual(mod.milestone("gh -R org/repo pr merge 3"), "merge")
        self.assertEqual(mod.milestone("gh --repo org/repo release create v1"), "release")

    def test_dry_run_help_heredoc(self):
        m = mod.milestone
        self.assertIsNone(m("git push --dry-run"))
        self.assertIsNone(m("gh pr create --help"))
        self.assertIsNone(m("cat <<EOF\ngit push\nEOF"))
        self.assertEqual(m("git commit -F - <<EOF\nmsg\nEOF"), "commit")


class Hooks(unittest.TestCase):
    def test_session_start_once(self):
        h, _ = setup()
        out = h["pre_llm_call"](session_id="s1", parent_session_id="", is_first_turn=True)
        self.assertEqual(out, {"context": G["session_start"]})
        self.assertIsNone(h["pre_llm_call"](session_id="s1", is_first_turn=False))

    def test_subagent_gets_subagent_text_only(self):
        h, _ = setup()
        out = h["pre_llm_call"](session_id="child", parent_session_id="s1", is_first_turn=True)
        self.assertEqual(out, {"context": G["subagent"]})

    def test_compaction(self):
        h, _ = setup()
        h["pre_llm_call"](session_id="s1", is_first_turn=True)
        h["post_compaction"](session_id="s2", old_session_id="s1", kind="summarize")
        self.assertEqual(h["pre_llm_call"](session_id="s2"), {"context": G["compacted"]})
        self.assertIsNone(h["pre_llm_call"](session_id="s2"))

    def test_milestone_appended_and_rate_limited(self):
        h, clock = setup()
        out = json.loads(shell(h, "git commit -m wip"))
        note = G["milestone"].replace("{what}", "you committed")
        self.assertEqual(out, {"output": "done\n\n" + note, "exit_code": 0})
        self.assertIsNone(shell(h, "git commit -m again", call="c2"))
        clock.minutes(5)
        self.assertIsNotNone(shell(h, "git commit -m later", call="c3"))

    def test_non_milestone_and_failed_command(self):
        h, _ = setup()
        self.assertIsNone(shell(h, "git status"))
        self.assertIsNone(shell(h, "git push", call="c2", status="error"))

    def test_plain_text_result(self):
        h, _ = setup()
        h["post_tool_call"](tool_name="terminal", args={"command": "git push"}, session_id="s1",
                            tool_call_id="c1", status="ok")
        out = h["transform_tool_result"](result="ok", session_id="s1", tool_call_id="c1")
        self.assertTrue(out.startswith("ok\n\nVenom milestone: you pushed"))

    def test_stop_asked_once_after_outcome(self):
        h, clock = setup()
        shell(h, "gh pr merge 5 --squash")
        h["pre_llm_call"](session_id="s1")  # a new turn keeps the question
        msg = h["pre_verify"](session_id="s1", attempt=0)
        self.assertEqual(msg, {"action": "continue",
                               "message": G["stop"].replace("{what}", "you merged a pull request")})
        self.assertIsNone(h["pre_verify"](session_id="s1", attempt=1))
        shell(h, "gh pr merge 7", call="c3")
        self.assertIsNone(h["pre_verify"](session_id="s1", attempt=0))  # within the stop gap

    def test_stop_question_expires_after_an_hour(self):
        h, clock = setup()
        shell(h, "npm publish")
        clock.minutes(61)
        self.assertIsNone(h["pre_verify"](session_id="s1", attempt=0))
        shell(h, "npm publish", call="c2")
        clock.minutes(59)
        self.assertIsNotNone(h["pre_verify"](session_id="s1", attempt=0))

    def test_commit_does_not_ask_at_stop(self):
        h, _ = setup()
        shell(h, "git commit -m x")
        self.assertIsNone(h["pre_verify"](session_id="s1", attempt=0))

    def test_venom_log_clears_stop(self):
        h, _ = setup()
        shell(h, "npm publish")
        h["post_tool_call"](tool_name="mcp_venom_append_task_log", args={}, session_id="s1",
                            tool_call_id="c9", status="ok")
        self.assertIsNone(h["pre_verify"](session_id="s1", attempt=0))

    def test_callbacks_never_raise(self):
        h, _ = setup()
        self.assertIsNone(h["post_tool_call"](tool_name="terminal", args="not a dict"))
        self.assertIsNone(h["transform_tool_result"](result=None))
        self.assertIsNone(h["pre_verify"](session_id=None, attempt=None))

    def test_register_wires_five_hooks(self):
        h, _ = setup()
        self.assertEqual(set(h), {"pre_llm_call", "post_tool_call", "transform_tool_result",
                                  "pre_verify", "post_compaction"})


if __name__ == "__main__":
    unittest.main()
