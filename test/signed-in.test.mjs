// The signed-in half of shared/venom-hook.sh: login, the session-start call to
// the Venom server, and every way it falls back to the fixed texts. A local
// fake server stands in for Venom; nothing here reads a real sign-in.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(root, "shared/venom-hook.sh");
const guidance = JSON.parse(readFileSync(join(root, "shared/guidance.json"), "utf8"));

function run(args, { input = "{}", env = {} } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn("sh", [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => done({ code, out: out.replace(/\n$/, ""), err, ms: Date.now() - started }));
    child.stdin.end(input);
  });
}

async function fakeVenom(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const request = { method: req.method, path: req.url, headers: req.headers, form: Object.fromEntries(new URLSearchParams(body)) };
      requests.push(request);
      handler(request, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

const reply = (res, status, body, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

async function withHome(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "venom-signed-in-"));
  const conf = join(tmp, "conf");
  const env = { TMPDIR: tmp, VENOM_HOOK_CONFIG: conf };
  try {
    await fn({ tmp, conf, env });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function signIn(conf, server, token = "vhk_test") {
  mkdirSync(conf, { recursive: true, mode: 0o700 });
  writeFileSync(join(conf, "hooks-token"), `token=${token}\nserver=${server}\norganization=Acme\n`, { mode: 0o600 });
}

const unescape = (line) => JSON.parse(`"${line}"`);
const nudgeLine = (text) => text.split("\n\n")[1] ?? "";

test("signed out: the day's first session start says how to sign in, once", () =>
  withHome(async ({ env }) => {
    const first = await run(["session-start"], { env });
    const text = unescape(first.out);
    assert.ok(text.startsWith(guidance.session_start + "\n\n"), text);
    assert.match(nudgeLine(text), /^Venom hooks aren't signed in on this machine/);
    assert.ok(nudgeLine(text).includes(`sh '${SCRIPT}' login`));
    assert.equal((await run(["session-start"], { env })).out, guidance.session_start);
    // Plugins ask only for what the sign-in adds: nothing, after today's note.
    assert.equal((await run(["session-extra"], { env })).out, "");
  }));

test("with no home folder at all, session start is the fixed text alone", () =>
  withHome(async ({ tmp }) => {
    const r = await run(["session-start"], { env: { TMPDIR: tmp } });
    assert.equal(r.out, guidance.session_start);
  }));

test("signed in: session start adds the server's text, escaped for a JSON string", async () => {
  const served = 'Venom projects in "Acme" you can find work in:\n- Web app (web) \\ the app\n\nTell your user.';
  const venom = await fakeVenom((req, res) => reply(res, 200, served));
  try {
    await withHome(async ({ conf, env }) => {
      signIn(conf, venom.url);
      const r = await run(["session-start"], {
        input: JSON.stringify({ session_id: "s1", source: "resume" }),
        env: { ...env, VENOM_HOOK_AGENT: "Cursor" },
      });
      assert.equal(r.code, 0);
      assert.ok(!r.out.includes("\n"), "one line");
      assert.equal(unescape(r.out), `${guidance.session_start}\n\n${served}`);
      const [request] = venom.requests;
      assert.equal(request.method, "POST");
      assert.equal(request.path, "/hooks/v1/guidance");
      assert.equal(request.headers.authorization, "Bearer vhk_test");
      assert.deepEqual(request.form, { event: "SessionStart", source: "resume", session_id: "s1", agent: "cursor" });

      // Plugins: only the server's part, as it is.
      const extra = await run(["session-extra"], {
        input: JSON.stringify({ session_id: "s2" }),
        env: { ...env, VENOM_HOOK_FORMAT: "text" },
      });
      assert.equal(extra.out, served);
    });
  } finally {
    await venom.close();
  }
});

test("a session keyed by process id is made unique to the machine and day", async () => {
  const venom = await fakeVenom((req, res) => reply(res, 200, ""));
  try {
    await withHome(async ({ conf, env }) => {
      signIn(conf, venom.url);
      const r = await run(["session-start"], { env: { ...env, VENOM_HOOK_SESSION: "ppid-4242" } });
      assert.equal(r.out, guidance.session_start, "an empty answer adds nothing");
      assert.match(venom.requests[0].form.session_id, /^ppid-4242-\d+-\d{8}$/);
      assert.equal(venom.requests[0].form.agent, "agent");
    });
  } finally {
    await venom.close();
  }
});

test("a 401 signs the machine out, and the hooks say how to sign in again", async () => {
  const venom = await fakeVenom((req, res) => reply(res, 401, "signed out"));
  try {
    await withHome(async ({ conf, env }) => {
      signIn(conf, venom.url);
      const text = unescape((await run(["session-start"], { env })).out);
      assert.match(nudgeLine(text), /aren't signed in/);
      assert.equal(existsSync(join(conf, "hooks-token")), false);
    });
  } finally {
    await venom.close();
  }
});

test("an outage falls back at once and skips the server for a while", async () => {
  const venom = await fakeVenom((req, res) => reply(res, 503, ""));
  try {
    await withHome(async ({ conf, env }) => {
      signIn(conf, venom.url);
      assert.equal((await run(["session-start"], { env })).out, guidance.session_start);
      assert.equal((await run(["session-start"], { env })).out, guidance.session_start);
      assert.equal(venom.requests.length, 1);
      // Still signed in: an outage is not a sign-out.
      assert.equal(existsSync(join(conf, "hooks-token")), true);
    });
  } finally {
    await venom.close();
  }
});

test("a slow server costs at most about 3 seconds", async () => {
  const venom = await fakeVenom((req, res) => setTimeout(() => reply(res, 200, "late"), 6000));
  try {
    await withHome(async ({ conf, env }) => {
      signIn(conf, venom.url);
      const r = await run(["session-start"], { env });
      assert.equal(r.out, guidance.session_start);
      assert.ok(r.ms < 4500, `${r.ms} ms`);
    });
  } finally {
    await venom.close();
  }
});

function deviceFlow({ approveAfter = 1 } = {}) {
  let polls = 0;
  return (req, res) => {
    if (req.path === "/hooks/v1/device") {
      return reply(res, 200, {
        device_code: "dc-secret",
        user_code: "BCDF-GHJK",
        verification_uri: "https://app.venomlabs.dev/mcp/device",
        verification_uri_complete: "https://app.venomlabs.dev/mcp/device?code=BCDF-GHJK",
        expires_in: 30,
        interval: 1,
      }, "application/json");
    }
    if (req.path === "/hooks/v1/token") {
      polls += 1;
      if (polls <= approveAfter) return reply(res, 400, { error: "authorization_pending" }, "application/json");
      return reply(res, 200, { access_token: "vhk_new", token_type: "Bearer", expires_in: 2592000, organization: "Acme" }, "application/json");
    }
    if (req.path === "/hooks/v1/revoke") return reply(res, 200, { revoked: true }, "application/json");
    return reply(res, 404, "");
  };
}

test("login prints the link, waits for approval and saves the sign-in privately", async () => {
  const venom = await fakeVenom(deviceFlow());
  try {
    await withHome(async ({ conf, env }) => {
      const r = await run(["login", "--wait"], { env: { ...env, VENOM_HOOK_SERVER: venom.url }, input: "" });
      assert.equal(r.code, 0, r.out + r.err);
      assert.ok(r.out.includes("https://app.venomlabs.dev/mcp/device?code=BCDF-GHJK"));
      assert.ok(r.out.includes("BCDF-GHJK"));
      assert.match(r.out, /Signed in to Acme/);
      const file = join(conf, "hooks-token");
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(conf).mode & 0o777, 0o700);
      assert.equal(readFileSync(file, "utf8"), `token=vhk_new\nserver=${venom.url}\norganization=Acme\n`);
      assert.equal(existsSync(join(conf, "hooks-login")), false);
      const polls = venom.requests.filter((q) => q.path === "/hooks/v1/token");
      assert.equal(polls[0].form.device_code, "dc-secret");
      assert.equal(polls[0].form.grant_type, "urn:ietf:params:oauth:grant-type:device_code");
      assert.match(venom.requests[0].form.device_name, /^[A-Za-z0-9._-]*$/);

      assert.match((await run(["status"], { env })).out, /signed in to Acme/);
      const out = await run(["logout"], { env });
      assert.match(out.out, /Signed out/);
      const revoke = venom.requests.find((q) => q.path === "/hooks/v1/revoke");
      assert.equal(revoke.headers.authorization, "Bearer vhk_new");
      assert.equal(existsSync(file), false);
      assert.match((await run(["status"], { env })).out, /aren't signed in/);
    });
  } finally {
    await venom.close();
  }
});

test("login from an agent's shell returns at once and finishes in the background", async () => {
  const venom = await fakeVenom(deviceFlow({ approveAfter: 1 }));
  try {
    await withHome(async ({ conf, env }) => {
      const r = await run(["login"], { env: { ...env, VENOM_HOOK_SERVER: venom.url }, input: "" });
      assert.equal(r.code, 0);
      assert.ok(r.ms < 3000, `${r.ms} ms`);
      assert.match(r.out, /finishes on its own/);
      assert.match((await run(["status"], { env })).out, /waiting for the sign-in/);
      const file = join(conf, "hooks-token");
      for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((w) => setTimeout(w, 100));
      assert.ok(readFileSync(file, "utf8").startsWith("token=vhk_new\n"));
    });
  } finally {
    await venom.close();
  }
});

test("a turned-down sign-in saves nothing", async () => {
  const venom = await fakeVenom((req, res) => {
    if (req.path === "/hooks/v1/device") return deviceFlow()(req, res);
    return reply(res, 400, { error: "access_denied" }, "application/json");
  });
  try {
    await withHome(async ({ conf, env }) => {
      const r = await run(["login", "--wait"], { env: { ...env, VENOM_HOOK_SERVER: venom.url }, input: "" });
      assert.equal(r.code, 1);
      assert.match(r.out, /turned down/);
      assert.equal(existsSync(join(conf, "hooks-token")), false);
    });
  } finally {
    await venom.close();
  }
});

test("the token never goes on a command line", () => {
  const script = readFileSync(SCRIPT, "utf8");
  for (const line of script.split("\n")) {
    if (/\bcurl\s+-/.test(line)) assert.doesNotMatch(line, /Bearer|\$token|device_code=\$/, line);
  }
  assert.match(script, /printf 'header = "Authorization: Bearer %s"\\n'/);
  assert.match(script, /curl -s -K - /);
  assert.match(script, /device_code@\$login_file/);
});

// Code and config only: a README may say that an agent itself uses the keychain.
test("no package touches the system keychain", () => {
  const banned = /\bsecurity\s+(add|find|delete)-(generic|internet)-password|secret-tool|keytar|\bkeyring\b|SecKeychain/;
  const skip = new Set([".git", "node_modules", "test"]);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(sh|js|mjs|ts|py|json|toml|yaml|yml)$|^[A-Z][A-Za-z]+$/.test(name)) {
        assert.doesNotMatch(readFileSync(path, "utf8"), banned, path);
      }
    }
  };
  walk(root);
});

// A curl on PATH that records its arguments, then runs the real one.
function recordingCurl(tmp) {
  const real = spawnSync("sh", ["-c", "command -v curl"], { encoding: "utf8" }).stdout.trim();
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  const log = join(tmp, "curl-args.log");
  writeFileSync(join(bin, "curl"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  return { path: `${bin}:${process.env.PATH}`, log };
}

test("no curl command line carries the token or the device code", async () => {
  const flow = deviceFlow();
  const venom = await fakeVenom((req, res) => (req.path.startsWith("/hooks/v1/guidance") ? reply(res, 200, "Projects") : flow(req, res)));
  try {
    await withHome(async ({ tmp, conf, env }) => {
      const curl = recordingCurl(tmp);
      const withCurl = { ...env, PATH: curl.path, VENOM_HOOK_SERVER: venom.url };
      assert.equal((await run(["login", "--wait"], { env: withCurl, input: "" })).code, 0);
      await run(["session-start"], { env: withCurl });
      await run(["logout"], { env: withCurl });
      const args = readFileSync(curl.log, "utf8");
      assert.match(args, /hooks\/v1\/guidance/);
      assert.doesNotMatch(args, /vhk_new|dc-secret|Bearer/);
      assert.equal(existsSync(join(conf, "hooks-token")), false);
    });
  } finally {
    await venom.close();
  }
});

test("a reply cut off part-way, or that isn't Venom's text, is not used", async () => {
  let mode = "stall";
  const venom = await fakeVenom((req, res) => {
    if (mode === "stall") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": "100" });
      res.write("Venom projects in Acme: ");
      return; // never finishes
    }
    reply(res, 200, "<html>Sign in to the proxy</html>", "text/html");
  });
  try {
    await withHome(async ({ tmp, conf, env }) => {
      signIn(conf, venom.url);
      const cut = await run(["session-start"], { env });
      assert.equal(cut.out, guidance.session_start);
      // Skipped for a while after that, so later sessions don't wait.
      assert.equal((await run(["session-start"], { env })).ms < 1000, true);
      assert.equal(venom.requests.length, 1);
      rmSync(join(tmp, `venom-hooks-${process.getuid()}`, "offline"));
      mode = "html";
      assert.equal((await run(["session-start"], { env })).out, guidance.session_start);
      assert.equal(existsSync(join(conf, "hooks-token")), true);
    });
  } finally {
    await venom.close();
  }
});

test("signing in again keeps the old sign-in until the new one is approved", async () => {
  let deny = true;
  const flow = deviceFlow();
  const venom = await fakeVenom((req, res) =>
    deny && req.path === "/hooks/v1/token" ? reply(res, 400, { error: "access_denied" }, "application/json") : flow(req, res));
  try {
    await withHome(async ({ conf, env }) => {
      signIn(conf, venom.url, "vhk_old");
      const withServer = { ...env, VENOM_HOOK_SERVER: venom.url };
      assert.equal((await run(["login", "--wait"], { env: withServer, input: "" })).code, 1);
      assert.match(readFileSync(join(conf, "hooks-token"), "utf8"), /token=vhk_old/);
      assert.equal(venom.requests.some((q) => q.path === "/hooks/v1/revoke"), false);
      deny = false;
      assert.equal((await run(["login", "--wait"], { env: withServer, input: "" })).code, 0);
      assert.match(readFileSync(join(conf, "hooks-token"), "utf8"), /token=vhk_new/);
      const revoke = venom.requests.find((q) => q.path === "/hooks/v1/revoke");
      assert.equal(revoke.headers.authorization, "Bearer vhk_old");
    });
  } finally {
    await venom.close();
  }
});

test("status finishes a sign-in whose background wait was stopped", async () => {
  const venom = await fakeVenom(deviceFlow({ approveAfter: 0 }));
  try {
    await withHome(async ({ conf, env }) => {
      mkdirSync(conf, { recursive: true, mode: 0o700 });
      writeFileSync(join(conf, "hooks-login"), "dc-secret", { mode: 0o600 });
      writeFileSync(join(conf, "hooks-login.server"), venom.url, { mode: 0o600 });
      assert.match((await run(["status"], { env })).out, /signed in to Acme/);
      assert.equal(existsSync(join(conf, "hooks-login")), false);
    });
  } finally {
    await venom.close();
  }
});
