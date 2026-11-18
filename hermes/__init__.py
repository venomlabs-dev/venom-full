"""Venom reminders for Hermes Agent.

Adds short Venom guidance to the model's context at the right moments. The texts
come from guidance.json, the same file every Venom agent package shares.

Hermes hook            What it adds
pre_llm_call           session start text on the first turn of a session, the subagent text in
                       a subagent, and the compaction text on the first turn after a compaction
post_tool_call         notes commits, pushes, pull requests, merges, releases and deploys after
                       a shell command, and clears the pending question when Venom is logged to
transform_tool_result  appends the milestone note to the shell result the model reads
pre_verify             asks once before finishing, after a merge, release, workflow, deploy or
                       publish with no Venom log call after it
post_compaction        remembers that the session was compacted

Every callback catches its own errors and returns None, so Venom never breaks a turn.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

GUIDANCE_PATH = Path(__file__).resolve().parent / "guidance.json"
SHELL_TOOLS = {"terminal", "shell", "bash", "execute_command"}
LOG_TOOLS = ("append_task_log", "append_project_log", "edit_log_entry")

# Checked in this order, like shared/venom-hook.sh: outcomes outrank the steps to them.
_ORDER = ("merge", "release", "workflow", "deploy", "publish", "commit", "push", "pr", "issue")
_S = r"(?:^|[;&|(]\s*)"
_E = r"(?=[\s;&|)]|$)"
_G = _S + r"git(?:\s+(?:-[Cc]\s+\S+|-\S+))*\s+"
_PATTERNS = {
    "commit": _G + r"commit" + _E,
    "push": _G + r"push" + _E,
    "pr": _S + r"gh\s+pr\s+create" + _E,
    "merge": _S + r"gh\s+pr\s+merge" + _E,
    "release": _S + r"gh\s+release\s+create" + _E,
    "issue": _S + r"gh\s+issue\s+close" + _E,
    "workflow": _S + r"gh\s+workflow\s+run" + _E,
    "deploy": (
        _S + r"(?:npx\s+)?(?:(?:vercel|netlify|fly|flyctl|firebase|wrangler|cdk|serverless|sls)\s+(?:[^;&|]*\s)?deploy"
        + _E + r"|vercel\s+(?:[^;&|]*\s)?--prod" + _E + r")"
        + "|" + _S + r"(?:terraform\s+apply|kubectl\s+apply|helm\s+upgrade)" + _E
    ),
    "publish": _S + r"(?:(?:npm|pnpm|yarn|cargo)\s+publish|docker\s+push|twine\s+upload)" + _E,
}
_COMPILED = {kind: re.compile(p) for kind, p in _PATTERNS.items()}
_ESCAPED_QUOTES = re.compile(r'\\"(?:[^"\\]|\\.)*\\"')
_DOUBLE_QUOTES = re.compile(r'"[^"]*"')
_SINGLE_QUOTES = re.compile(r"'[^']*'")


def load_guidance(path: Path = GUIDANCE_PATH) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def milestone(command: Any) -> Optional[str]:
    """The milestone a shell command reaches, or None. Quoted text is data."""
    if not isinstance(command, str):
        return None
    line = _ESCAPED_QUOTES.sub("", command)
    line = _DOUBLE_QUOTES.sub("", line)
    line = _SINGLE_QUOTES.sub("", line)
    line = line.replace("\r", "").replace("\n", ";")
    for kind in _ORDER:
        if _COMPILED[kind].search(line):
            return kind
    return None


class Venom:
    """Per-process memory of what each session has been told."""

    def __init__(self, guidance: Dict[str, Any], clock: Callable[[], float] = time.monotonic):
        self.g = guidance
        self.clock = clock
        self.lock = threading.Lock()
        self.told: set = set()
        self.compacted: set = set()
        self.pending: Dict[str, str] = {}
        self.last_milestone: Dict[str, float] = {}
        self.last_stop: Dict[str, float] = {}
        self.notes: Dict[str, str] = {}

    def _what(self, kind: str) -> str:
        return self.g["milestones"].get(kind, "you finished a step")

    def _recent(self, table: Dict[str, float], key: str, minutes: float) -> bool:
        last = table.get(key)
        return last is not None and self.clock() - last < minutes * 60

    # pre_llm_call
    def before_turn(self, session_id: str, parent_session_id: str = "", is_first_turn: bool = False) -> Optional[str]:
        sid = session_id or ""
        parts = []
        with self.lock:
            self.pending.pop(sid, None)  # a stop question is only about the turn it follows
            if sid not in self.told:
                self.told.add(sid)
                parts.append(self.g["subagent"] if parent_session_id else self.g["session_start"])
            if sid in self.compacted:
                self.compacted.discard(sid)
                parts.append(self.g["compacted"])
        return "\n\n".join(parts) or None

    # post_compaction
    def after_compaction(self, session_id: str, old_session_id: str = "") -> None:
        with self.lock:
            for sid in (session_id, old_session_id):
                if sid:
                    self.compacted.add(sid)
                    self.told.add(sid)  # a compacted session already had its start

    # post_tool_call
    def after_tool(self, session_id: str, tool_name: str, args: Any, call_id: str = "", ok: bool = True) -> None:
        sid = session_id or ""
        haystack = str(tool_name or "")
        if haystack.startswith("tool_") or haystack == "mcp_tool_call":
            haystack += " " + str(args)[:2000]
        if any(name in haystack for name in LOG_TOOLS):
            with self.lock:
                self.pending.pop(sid, None)
            return
        if not ok or tool_name not in SHELL_TOOLS or not isinstance(args, dict):
            return
        kind = milestone(args.get("command") or args.get("cmd"))
        if not kind:
            return
        with self.lock:
            if kind in self.g["stop_kinds"]:
                self.pending[sid] = kind
            key = f"{sid}:{kind}"
            if self._recent(self.last_milestone, key, self.g["milestone_gap_minutes"]):
                return
            self.last_milestone[key] = self.clock()
            if len(self.notes) > 200:
                self.notes.clear()
            self.notes[call_id or f"{sid}:last"] = self.g["milestone"].replace("{what}", self._what(kind))

    # transform_tool_result
    def rewrite_result(self, call_id: str, session_id: str, result: Any) -> Optional[str]:
        with self.lock:
            note = self.notes.pop(call_id or f"{session_id or ''}:last", None)
        if not note or not isinstance(result, str):
            return None
        try:
            data = json.loads(result)
        except ValueError:
            data = None
        if isinstance(data, dict) and isinstance(data.get("output"), str):
            data["output"] = f"{data['output']}\n\n{note}" if data["output"] else note
            return json.dumps(data, ensure_ascii=False)
        return f"{result}\n\n{note}"

    # pre_verify
    def before_finish(self, session_id: str, attempt: int = 0) -> Optional[Dict[str, str]]:
        sid = session_id or ""
        if attempt:
            return None
        with self.lock:
            kind = self.pending.pop(sid, None)
            if not kind or self._recent(self.last_stop, sid, self.g["stop_gap_minutes"]):
                return None
            self.last_stop[sid] = self.clock()
        return {"action": "continue", "message": self.g["stop"].replace("{what}", self._what(kind))}


def _guarded(fn: Callable[..., Any]) -> Callable[..., Any]:
    def run(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except Exception:  # Venom must never break a turn
            logger.debug("venom hook failed", exc_info=True)
            return None

    return run


def register(ctx: Any, venom: Optional[Venom] = None) -> None:
    v = venom or Venom(load_guidance())

    def pre_llm_call(session_id="", parent_session_id="", is_first_turn=False, **_kw):
        text = v.before_turn(session_id, parent_session_id or "", is_first_turn)
        return {"context": text} if text else None

    def post_tool_call(tool_name="", args=None, session_id="", tool_call_id="", status="ok", **_kw):
        v.after_tool(session_id, tool_name, args, tool_call_id or "", status in (None, "ok", "success"))

    def transform_tool_result(result=None, session_id="", tool_call_id="", **_kw):
        return v.rewrite_result(tool_call_id or "", session_id, result)

    def pre_verify(session_id="", attempt=0, **_kw):
        return v.before_finish(session_id, attempt or 0)

    def post_compaction(session_id="", old_session_id="", **_kw):
        v.after_compaction(session_id, old_session_id or "")

    ctx.register_hook("pre_llm_call", _guarded(pre_llm_call))
    ctx.register_hook("post_tool_call", _guarded(post_tool_call))
    ctx.register_hook("transform_tool_result", _guarded(transform_tool_result))
    ctx.register_hook("pre_verify", _guarded(pre_verify))
    ctx.register_hook("post_compaction", _guarded(post_compaction))
