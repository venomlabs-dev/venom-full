#!/usr/bin/env node
// A stand-in OpenAI-compatible model for the Copilot live test (run.sh).
//
//   node mock-model.mjs <port> <requests.jsonl>
//
// It records every request, then answers the first turn with one shell tool
// call (an empty git commit, a Venom milestone) and every later turn with
// "Done.". Streaming and plain responses both work.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, log] = process.argv.slice(2);
const COMMAND = 'git commit --allow-empty -m "venom smoke"';

// Arguments for the shell tool, from its JSON schema: the command, and a plain
// value for anything else it requires.
function shellArgs(tool) {
  const params = tool.function.parameters ?? {};
  const args = { command: COMMAND };
  for (const name of params.required ?? []) {
    if (name in args) continue;
    const type = params.properties?.[name]?.type;
    args[name] = type === "boolean" ? false : type === "number" || type === "integer" ? 30 : "venom smoke";
  }
  return args;
}

function reply(body) {
  const messages = body.messages ?? [];
  const shell = (body.tools ?? []).find((t) => /^(bash|shell|powershell)$/i.test(t.function?.name ?? ""));
  const toolTurn = messages.some((m) => m.role === "tool");
  if (shell && !toolTurn) {
    return {
      tool_calls: [
        { index: 0, id: "call_venom_1", type: "function",
          function: { name: shell.function.name, arguments: JSON.stringify(shellArgs(shell)) } },
      ],
      finish: "tool_calls",
    };
  }
  return { content: "Done.", finish: "stop" };
}

const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}
    appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, body }) + "\n");
    if (req.method === "GET" && /\/models\/?$/.test(req.url)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
      return;
    }
    if (!/\/chat\/completions\/?$/.test(req.url)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `not mocked: ${req.url}` } }));
      return;
    }
    const out = reply(body);
    const message = { role: "assistant", content: out.content ?? null };
    if (out.tool_calls) message.tool_calls = out.tool_calls.map(({ index, ...c }) => c);
    const base = { id: "chatcmpl-venom", created: Math.floor(Date.now() / 1000), model: body.model ?? "mock-model" };
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...base, object: "chat.completion", usage,
        choices: [{ index: 0, message, finish_reason: out.finish }] }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (choice, extra = {}) =>
      res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [choice], ...extra })}\n\n`);
    const delta = { role: "assistant" };
    if (out.content) delta.content = out.content;
    if (out.tool_calls) delta.tool_calls = out.tool_calls;
    send({ index: 0, delta, finish_reason: null });
    send({ index: 0, delta: {}, finish_reason: out.finish }, { usage });
    res.end("data: [DONE]\n\n");
  });
}).listen(Number(port), "127.0.0.1");
