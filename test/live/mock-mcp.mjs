#!/usr/bin/env node
// A stand-in for the Venom MCP server's sign-in, for live tests that check an
// app asks for Venom's OAuth sign-in without touching the real server.
//
//   node mock-mcp.mjs <port> <requests.jsonl>
//
// Like https://mcp.venomlabs.dev, it answers any MCP request without a token
// with 401 and a WWW-Authenticate header naming its protected-resource
// metadata, and serves the OAuth metadata and dynamic client registration an
// MCP client needs to build the sign-in link. It records every request. It
// never issues a token: the test ends at "asks the user to sign in".
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, log] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const path = new URL(req.url, base).pathname;
    appendFileSync(
      log,
      JSON.stringify({ method: req.method, path, auth: Boolean(req.headers.authorization), body: raw.slice(0, 2000) }) + "\n",
    );
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      return json(res, 200, { resource: `${base}/`, authorization_servers: [base], bearer_methods_supported: ["header"] });
    }
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (path === "/register" && req.method === "POST") {
      let meta = {};
      try { meta = JSON.parse(raw); } catch {}
      return json(res, 201, { ...meta, client_id: "venom-live-test", client_id_issued_at: Math.floor(Date.now() / 1000) });
    }
    if (path === "/token") return json(res, 400, { error: "invalid_grant" });
    if (path === "/authorize") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("Sign in to Venom (stand-in).");
    }
    // Everything else is the MCP endpoint: no token, no entry.
    json(res, 401, { error: "invalid_token", error_description: "Sign in to Venom." }, {
      "www-authenticate": `Bearer error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    });
  });
}).listen(Number(port), "127.0.0.1");
