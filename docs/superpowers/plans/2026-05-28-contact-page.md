# Bonfire Contact Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Contact button to the Bonfire homepage and a branded contact subpage with a form that verifies Cloudflare Turnstile and posts to a Slack incoming webhook, hosted on Vercel as a static site plus one serverless function.

**Architecture:** Two hand-authored HTML pages and one Node 20 serverless function at `api/contact.js`. The function is decomposed into pure helpers (`api/_lib/validate.js`, `api/_lib/slack.js`, `api/_lib/turnstile.js`), each covered by unit tests under Node's built-in `node:test` runner. Vercel ignores `api/_lib/` from public routing because of the underscore prefix. No build step, no framework, no production dependencies.

**Tech Stack:** Static HTML/CSS (no framework), Node 20 ESM, `node:test`, Cloudflare Turnstile, Slack incoming webhooks, Vercel for hosting + serverless functions.

**Spec:** [`docs/superpowers/specs/2026-05-28-contact-page-design.md`](../specs/2026-05-28-contact-page-design.md)

**Working directory:** `/Users/jameswilliamson/Agent/Misc/BF Website`
**Branch:** `feat/contact-page` (already created and contains the spec commit)
**Commit author:** `jbw@buildabonfire.com` (already configured for this repo)

---

## Task 1: Pre-flight — confirm Vercel account, git author, and branch

**Files:** none.

- [ ] **Step 1: Confirm you are on `feat/contact-page`**

```bash
cd "/Users/jameswilliamson/Agent/Misc/BF Website" && git branch --show-current
```

Expected: `feat/contact-page`. If not, `git checkout feat/contact-page`.

- [ ] **Step 2: Confirm git author email**

```bash
git config user.email
```

Expected: `jbw@buildabonfire.com`. If different, set it: `git config user.email jbw@buildabonfire.com`. Vercel Hobby blocks deploys when the commit author email isn't verified on the team-owner account.

- [ ] **Step 3: Confirm Vercel account**

```bash
vercel whoami
```

Expected: the personal Bonfire-owning Vercel account (NOT `jwilliamson-1933` — that's USMS — and NOT any PAS account). If wrong, run `vercel login` and switch accounts. Deploys silently route to a different team and a different URL when the account is wrong.

---

## Task 2: Scaffold `package.json`

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "bonfire-site",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test"
  }
}
```

`"type": "module"` lets us use `import`/`export` in `.js` files. `node --test` with no arguments auto-discovers `**/*.test.{js,mjs,cjs}` from the current directory.

- [ ] **Step 2: Confirm Node is 20+**

```bash
node --version
```

Expected: `v20.x.x` or newer. If older, install Node 20+ before continuing.

- [ ] **Step 3: Commit**

```bash
git add package.json && git commit -m "Add package.json with ESM and node:test runner"
```

---

## Task 3: Input validation helpers (TDD)

**Files:**
- Create: `api/_lib/validate.js`
- Test: `api/_lib/validate.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/_lib/validate.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContactInput } from "./validate.js";

test("accepts a well-formed submission", () => {
  const result = validateContactInput({
    name: "Ada Lovelace",
    email: "ada@example.com",
    message: "Hi there",
    turnstileToken: "tk_123"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    message: "Hi there",
    turnstileToken: "tk_123"
  });
});

test("trims surrounding whitespace on name and message", () => {
  const result = validateContactInput({
    name: "  Ada  ",
    email: "ada@example.com",
    message: "  hello  ",
    turnstileToken: "tk"
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.name, "Ada");
  assert.equal(result.value.message, "hello");
});

test("rejects missing fields", () => {
  for (const missing of ["name", "email", "message", "turnstileToken"]) {
    const input = {
      name: "Ada",
      email: "ada@example.com",
      message: "Hi",
      turnstileToken: "tk"
    };
    delete input[missing];
    const result = validateContactInput(input);
    assert.equal(result.ok, false, `should reject missing ${missing}`);
  }
});

test("rejects oversized name (>120 chars)", () => {
  const result = validateContactInput({
    name: "a".repeat(121),
    email: "ada@example.com",
    message: "Hi",
    turnstileToken: "tk"
  });
  assert.equal(result.ok, false);
});

test("rejects oversized message (>2000 chars)", () => {
  const result = validateContactInput({
    name: "Ada",
    email: "ada@example.com",
    message: "a".repeat(2001),
    turnstileToken: "tk"
  });
  assert.equal(result.ok, false);
});

test("rejects malformed email", () => {
  for (const bad of ["not-an-email", "a@b", "no-at-sign.com", "@nodomain", "user@nodot"]) {
    const result = validateContactInput({
      name: "Ada",
      email: bad,
      message: "Hi",
      turnstileToken: "tk"
    });
    assert.equal(result.ok, false, `should reject "${bad}"`);
  }
});

test("rejects non-string field types", () => {
  const result = validateContactInput({
    name: 42,
    email: "ada@example.com",
    message: "Hi",
    turnstileToken: "tk"
  });
  assert.equal(result.ok, false);
});

test("rejects null, undefined, and non-object input", () => {
  assert.equal(validateContactInput(null).ok, false);
  assert.equal(validateContactInput(undefined).ok, false);
  assert.equal(validateContactInput("nope").ok, false);
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test
```

Expected: tests fail with `Cannot find module './validate.js'` or similar.

- [ ] **Step 3: Write the implementation**

Create `api/_lib/validate.js`:

```js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactInput(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid input" };
  }

  const { name, email, message, turnstileToken } = body;

  if (typeof name !== "string" || typeof email !== "string" ||
      typeof message !== "string" || typeof turnstileToken !== "string") {
    return { ok: false, error: "Invalid input" };
  }

  const trimmedName = name.trim();
  const trimmedMessage = message.trim();
  const trimmedToken = turnstileToken.trim();

  if (trimmedName.length < 1 || trimmedName.length > 120) {
    return { ok: false, error: "Invalid input" };
  }
  if (email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Invalid input" };
  }
  if (trimmedMessage.length < 1 || trimmedMessage.length > 2000) {
    return { ok: false, error: "Invalid input" };
  }
  if (trimmedToken.length < 1) {
    return { ok: false, error: "Invalid input" };
  }

  return {
    ok: true,
    value: {
      name: trimmedName,
      email,
      message: trimmedMessage,
      turnstileToken: trimmedToken
    }
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test
```

Expected: all validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/validate.js api/_lib/validate.test.js
git commit -m "Add contact form input validation"
```

---

## Task 4: Slack payload builder (TDD)

**Files:**
- Create: `api/_lib/slack.js`
- Test: `api/_lib/slack.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/_lib/slack.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeForSlack, buildSlackPayload } from "./slack.js";

test("escapeForSlack encodes mrkdwn-significant characters", () => {
  assert.equal(escapeForSlack("a & b"), "a &amp; b");
  assert.equal(escapeForSlack("a < b"), "a &lt; b");
  assert.equal(escapeForSlack("a > b"), "a &gt; b");
  assert.equal(escapeForSlack("a & <b> & c"), "a &amp; &lt;b&gt; &amp; c");
});

test("escapeForSlack preserves plain text and newlines", () => {
  assert.equal(escapeForSlack("Hello\nWorld"), "Hello\nWorld");
  assert.equal(escapeForSlack("plain"), "plain");
});

test("escapeForSlack handles empty and missing input", () => {
  assert.equal(escapeForSlack(""), "");
  assert.equal(escapeForSlack(null), "");
  assert.equal(escapeForSlack(undefined), "");
});

test("buildSlackPayload formats a contact submission", () => {
  const payload = buildSlackPayload({
    name: "Ada",
    email: "ada@example.com",
    message: "Hello"
  });
  assert.deepEqual(payload, {
    text: "New Bonfire contact form\n*Name:* Ada\n*Email:* ada@example.com\n*Message:*\nHello"
  });
});

test("buildSlackPayload prepends a mention with a trailing space", () => {
  const payload = buildSlackPayload(
    { name: "Ada", email: "ada@example.com", message: "Hi" },
    "<@U01234ABC>"
  );
  assert.match(payload.text, /^<@U01234ABC> New Bonfire contact form\n/);
});

test("buildSlackPayload omits mention prefix when empty", () => {
  const payload = buildSlackPayload(
    { name: "Ada", email: "ada@example.com", message: "Hi" },
    ""
  );
  assert.match(payload.text, /^New Bonfire contact form\n/);
});

test("buildSlackPayload escapes user input but not the mention", () => {
  const payload = buildSlackPayload(
    { name: "<script>", email: "a@b.co", message: "x & y" },
    "<@U01>"
  );
  assert.match(payload.text, /^<@U01> /);                    // mention preserved verbatim
  assert.match(payload.text, /\*Name:\* &lt;script&gt;/);    // user input escaped
  assert.match(payload.text, /x &amp; y/);
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test
```

Expected: Slack tests fail with module-not-found.

- [ ] **Step 3: Write the implementation**

Create `api/_lib/slack.js`:

```js
export function escapeForSlack(input) {
  if (input == null) return "";
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildSlackPayload({ name, email, message }, mention = "") {
  const prefix = mention ? `${mention} ` : "";
  const text = [
    `${prefix}New Bonfire contact form`,
    `*Name:* ${escapeForSlack(name)}`,
    `*Email:* ${escapeForSlack(email)}`,
    `*Message:*`,
    escapeForSlack(message)
  ].join("\n");
  return { text };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test
```

Expected: all Slack tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/slack.js api/_lib/slack.test.js
git commit -m "Add Slack payload builder with mrkdwn escaping"
```

---

## Task 5: Turnstile verifier with injectable fetch (TDD)

**Files:**
- Create: `api/_lib/turnstile.js`
- Test: `api/_lib/turnstile.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/_lib/turnstile.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTurnstile } from "./turnstile.js";

function mockFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body
    };
  };
  fn.calls = calls;
  return fn;
}

test("returns true when Cloudflare reports success", async () => {
  const fetch = mockFetch({ body: { success: true } });
  const ok = await verifyTurnstile({
    token: "tk_123",
    secret: "secret_abc",
    remoteIp: "1.2.3.4",
    fetch
  });
  assert.equal(ok, true);
});

test("returns false when Cloudflare reports failure", async () => {
  const fetch = mockFetch({ body: { success: false, "error-codes": ["timeout-or-duplicate"] } });
  const ok = await verifyTurnstile({
    token: "tk_123",
    secret: "secret_abc",
    fetch
  });
  assert.equal(ok, false);
});

test("returns false on non-2xx response", async () => {
  const fetch = mockFetch({ ok: false, status: 500, body: {} });
  const ok = await verifyTurnstile({
    token: "tk_123",
    secret: "secret_abc",
    fetch
  });
  assert.equal(ok, false);
});

test("returns false when fetch throws", async () => {
  const fetch = async () => { throw new Error("network"); };
  const ok = await verifyTurnstile({
    token: "tk_123",
    secret: "secret_abc",
    fetch
  });
  assert.equal(ok, false);
});

test("posts secret, response, and remoteip as form-encoded body", async () => {
  const fetch = mockFetch({ body: { success: true } });
  await verifyTurnstile({
    token: "tk_xyz",
    secret: "secret_abc",
    remoteIp: "9.9.9.9",
    fetch
  });
  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0];
  assert.equal(call.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get("secret"), "secret_abc");
  assert.equal(body.get("response"), "tk_xyz");
  assert.equal(body.get("remoteip"), "9.9.9.9");
});

test("omits remoteip when not provided", async () => {
  const fetch = mockFetch({ body: { success: true } });
  await verifyTurnstile({ token: "tk", secret: "s", fetch });
  const body = new URLSearchParams(fetch.calls[0].init.body);
  assert.equal(body.has("remoteip"), false);
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test
```

Expected: Turnstile tests fail with module-not-found.

- [ ] **Step 3: Write the implementation**

Create `api/_lib/turnstile.js`:

```js
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile({ token, secret, remoteIp, fetch: fetchFn = fetch }) {
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  if (remoteIp) params.set("remoteip", remoteIp);

  try {
    const res = await fetchFn(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test
```

Expected: all Turnstile tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/turnstile.js api/_lib/turnstile.test.js
git commit -m "Add Turnstile verifier with injectable fetch"
```

---

## Task 6: Contact function handler (TDD with mocked dependencies)

**Files:**
- Create: `api/contact.js`
- Test: `api/contact.test.js`

The function exposes two things: `handleContact` (pure, testable, takes everything as params), and a default export adapting Vercel's `(req, res)` signature to it. The tests target `handleContact`.

- [ ] **Step 1: Write the failing tests**

Create `api/contact.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleContact } from "./contact.js";

function makeFetchSpy(responses) {
  // responses keyed by URL substring
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const match = Object.entries(responses).find(([key]) => url.includes(key));
    if (!match) throw new Error(`unmocked fetch to ${url}`);
    const [, response] = match;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {}
    };
  };
  fn.calls = calls;
  return fn;
}

const validBody = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "Hello",
  turnstileToken: "tk_valid"
};

const env = {
  TURNSTILE_SECRET: "ts_secret",
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/AAA/BBB/CCC",
  SLACK_MENTION: "<@U01>"
};

test("rejects non-POST with 405", async () => {
  const fetch = makeFetchSpy({});
  const result = await handleContact({ method: "GET", body: {}, env, fetch });
  assert.equal(result.status, 405);
  assert.equal(result.body.error, "Method not allowed");
});

test("rejects malformed body with 400 and skips Turnstile + Slack", async () => {
  const fetch = makeFetchSpy({});
  const result = await handleContact({ method: "POST", body: { name: "x" }, env, fetch });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Invalid input");
  assert.equal(fetch.calls.length, 0);
});

test("honeypot (non-empty hp_url) returns 200 silently and skips Turnstile + Slack", async () => {
  const fetch = makeFetchSpy({});
  const result = await handleContact({
    method: "POST",
    body: { ...validBody, hp_url: "http://spam.example" },
    env,
    fetch
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(fetch.calls.length, 0);
});

test("honeypot with empty string is treated as legitimate (proceeds to Turnstile + Slack)", async () => {
  const fetch = makeFetchSpy({
    "siteverify": { body: { success: true } },
    "hooks.slack.com": { body: {} }
  });
  const result = await handleContact({
    method: "POST",
    body: { ...validBody, hp_url: "" },
    env,
    fetch
  });
  assert.equal(result.status, 200);
  assert.equal(fetch.calls.length, 2);
});

test("Turnstile failure returns 400 and skips Slack", async () => {
  const fetch = makeFetchSpy({
    "siteverify": { body: { success: false } }
  });
  const result = await handleContact({ method: "POST", body: validBody, env, fetch });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Captcha failed");
  assert.equal(fetch.calls.length, 1);
});

test("Slack non-2xx returns 502", async () => {
  const fetch = makeFetchSpy({
    "siteverify": { body: { success: true } },
    "hooks.slack.com": { ok: false, status: 500 }
  });
  const result = await handleContact({ method: "POST", body: validBody, env, fetch });
  assert.equal(result.status, 502);
  assert.equal(result.body.error, "Delivery failed");
});

test("happy path returns 200 and posts mention-prefixed payload", async () => {
  const fetch = makeFetchSpy({
    "siteverify": { body: { success: true } },
    "hooks.slack.com": { body: {} }
  });
  const result = await handleContact({
    method: "POST",
    body: validBody,
    env,
    fetch,
    remoteIp: "1.2.3.4"
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });

  const slackCall = fetch.calls.find(c => c.url.includes("hooks.slack.com"));
  assert.ok(slackCall, "should have called Slack");
  const sent = JSON.parse(slackCall.init.body);
  assert.match(sent.text, /^<@U01> New Bonfire contact form/);
  assert.match(sent.text, /\*Name:\* Ada Lovelace/);
  assert.match(sent.text, /\*Email:\* ada@example\.com/);
  assert.match(sent.text, /\*Message:\*\nHello/);

  const turnstileCall = fetch.calls.find(c => c.url.includes("siteverify"));
  const tsBody = new URLSearchParams(turnstileCall.init.body);
  assert.equal(tsBody.get("secret"), "ts_secret");
  assert.equal(tsBody.get("response"), "tk_valid");
  assert.equal(tsBody.get("remoteip"), "1.2.3.4");
});

test("missing SLACK_MENTION env produces no prefix", async () => {
  const fetch = makeFetchSpy({
    "siteverify": { body: { success: true } },
    "hooks.slack.com": { body: {} }
  });
  await handleContact({
    method: "POST",
    body: validBody,
    env: { ...env, SLACK_MENTION: undefined },
    fetch
  });
  const sent = JSON.parse(fetch.calls.find(c => c.url.includes("hooks.slack.com")).init.body);
  assert.match(sent.text, /^New Bonfire contact form/);
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test
```

Expected: contact tests fail with module-not-found.

- [ ] **Step 3: Write the implementation**

Create `api/contact.js`:

```js
import { validateContactInput } from "./_lib/validate.js";
import { verifyTurnstile } from "./_lib/turnstile.js";
import { buildSlackPayload } from "./_lib/slack.js";

export async function handleContact({ method, body, env, fetch: fetchFn = fetch, remoteIp }) {
  if (method !== "POST") {
    return { status: 405, body: { error: "Method not allowed" } };
  }

  // Honeypot — bots that fill `hp_url` get a silent 200.
  if (typeof body?.hp_url === "string" && body.hp_url.length > 0) {
    return { status: 200, body: { ok: true } };
  }

  const validation = validateContactInput(body);
  if (!validation.ok) {
    return { status: 400, body: { error: validation.error } };
  }
  const input = validation.value;

  const captchaOk = await verifyTurnstile({
    token: input.turnstileToken,
    secret: env.TURNSTILE_SECRET,
    remoteIp,
    fetch: fetchFn
  });
  if (!captchaOk) {
    return { status: 400, body: { error: "Captcha failed" } };
  }

  const payload = buildSlackPayload(input, env.SLACK_MENTION ?? "");
  let slackRes;
  try {
    slackRes = await fetchFn(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("Slack post failed:", err.message);
    return { status: 502, body: { error: "Delivery failed" } };
  }
  if (!slackRes.ok) {
    console.error("Slack returned non-2xx:", slackRes.status);
    return { status: 502, body: { error: "Delivery failed" } };
  }

  return { status: 200, body: { ok: true } };
}

// Vercel Node function entrypoint — adapts (req, res) to handleContact.
export default async function (req, res) {
  let body = {};
  if (req.method === "POST") {
    // Vercel's Node runtime auto-parses JSON when Content-Type is application/json.
    body = req.body && typeof req.body === "object" ? req.body : {};
  }

  const xff = req.headers["x-forwarded-for"];
  const remoteIp = typeof xff === "string" ? xff.split(",")[0].trim() : undefined;

  const result = await handleContact({
    method: req.method,
    body,
    env: process.env,
    fetch,
    remoteIp
  });

  res.status(result.status).json(result.body);
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test
```

Expected: all tests (validate, slack, turnstile, contact) pass.

- [ ] **Step 5: Commit**

```bash
git add api/contact.js api/contact.test.js
git commit -m "Add /api/contact handler with Turnstile and Slack delivery"
```

---

## Task 7: Vercel config — clean URLs and security headers

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create vercel.json**

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=()" }
      ]
    }
  ]
}
```

`cleanUrls: true` serves `contact.html` at `/contact`. Functions under `api/` are auto-routed; helpers under `api/_lib/` are not exposed (Vercel ignores files/dirs starting with `_`).

- [ ] **Step 2: Commit**

```bash
git add vercel.json && git commit -m "Add Vercel config for clean URLs and security headers"
```

---

## Task 8: Contact page HTML and styles (no submit script yet)

**Files:**
- Create: `contact.html`

The Turnstile site key in the HTML below is a sentinel: `YOUR_TURNSTILE_SITE_KEY_HERE`. Task 13 replaces it with the real public key. Don't replace it now — it's intentional so deploy-time substitution is visible.

- [ ] **Step 1: Create contact.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Contact — Bonfire</title>
  <meta name="description" content="Contact Bonfire about nonprofit digital transformation, AI collaborations, or to get in touch with James." />
  <link rel="icon" href="/favicon.png" type="image/png" />
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    :root {
      --bonfire-orange: #CC6404;
      --bonfire-orange-dark: #A85003;
      --bonfire-tan: #ECBC94;
      --bonfire-light-tan: #F3DBC2;
      --bonfire-gray: #9C9C9C;
      --bonfire-charcoal: #2C2C2C;
      --bonfire-dark: #1A1A1A;
      --text-primary: #1A1A1A;
      --text-secondary: #4A4A4A;
      --text-muted: #7A7A7A;
      --border: #E0E0E0;
      --bg-subtle: #FAF8F6;
      --bg-warm: #FDF8F3;
      --color-error: #C23B22;
      --color-success: #2D7A3A;
      --space-sm: 8px;
      --space-md: 16px;
      --space-lg: 24px;
      --space-xl: 32px;
      --space-2xl: 48px;
      --space-3xl: 64px;
      --radius: 8px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text-primary);
      background: #FFFFFF;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-md) var(--space-lg);
      border-bottom: 1px solid var(--border);
      background: #fff;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 15px;
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius);
      transition: color 0.2s ease, background 0.2s ease;
    }
    .back-link:hover { color: var(--bonfire-orange); background: var(--bg-subtle); }
    .back-link:focus-visible { outline: 2px solid var(--bonfire-orange); outline-offset: 2px; }
    .back-link svg { width: 18px; height: 18px; }

    .topbar-logo { height: 28px; width: auto; display: block; }

    main {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--space-3xl) var(--space-lg) var(--space-2xl);
    }

    h1 {
      font-size: clamp(28px, 4vw, 36px);
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: -0.02em;
      margin-bottom: var(--space-md);
      text-align: center;
    }

    .lead {
      color: var(--text-secondary);
      font-size: 17px;
      text-align: center;
      max-width: 540px;
      margin: 0 auto var(--space-2xl);
    }

    .card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: var(--space-xl);
      max-width: 560px;
      margin: 0 auto;
    }

    .field { margin-bottom: var(--space-lg); }
    .field label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--space-sm);
    }
    .input, .textarea {
      font-family: inherit;
      font-size: 16px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #fff;
      color: var(--text-primary);
      width: 100%;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .input:focus, .textarea:focus {
      outline: none;
      border-color: var(--bonfire-orange);
      box-shadow: 0 0 0 3px rgba(204, 100, 4, 0.15);
    }
    .input[aria-invalid="true"], .textarea[aria-invalid="true"] {
      border-color: var(--color-error);
    }
    .textarea { resize: vertical; min-height: 140px; line-height: 1.5; }
    .input::placeholder, .textarea::placeholder { color: var(--bonfire-gray); }

    .char-count { font-size: 12px; color: var(--text-muted); text-align: right; margin-top: 4px; }
    .char-count.over { color: var(--color-error); }

    .honeypot {
      position: absolute;
      left: -9999px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    }

    .turnstile-wrap { margin: var(--space-lg) 0; }

    .btn {
      font-family: inherit;
      font-size: 16px;
      font-weight: 600;
      padding: 12px 24px;
      border-radius: 6px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      width: 100%;
    }
    .btn:focus-visible { outline: 2px solid var(--bonfire-orange); outline-offset: 2px; }
    .btn-primary {
      background: var(--bonfire-orange);
      color: #fff;
      border-color: var(--bonfire-orange);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--bonfire-orange-dark);
      border-color: var(--bonfire-orange-dark);
    }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    .status {
      margin-top: var(--space-md);
      min-height: 1.2em;
      font-size: 14px;
    }
    .status.error { color: var(--color-error); }

    .success {
      background: var(--bg-warm);
      border: 1px solid var(--bonfire-light-tan);
      border-radius: var(--radius);
      padding: var(--space-xl);
      max-width: 560px;
      margin: 0 auto;
      text-align: center;
    }
    .success h2 {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: var(--space-sm);
    }
    .success p { color: var(--text-secondary); margin-bottom: var(--space-md); }
    .success a { color: var(--bonfire-orange); font-weight: 600; text-decoration: none; }
    .success a:hover { text-decoration: underline; }

    @media (min-width: 640px) {
      .btn { width: auto; }
      .btn-primary { padding: 12px 32px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <a class="back-link" href="/" aria-label="Back to home">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M19 12H5"></path>
        <path d="M12 19l-7-7 7-7"></path>
      </svg>
      Back
    </a>
    <a href="/" aria-label="Bonfire home">
      <img class="topbar-logo" src="https://buildabonfire.com/assets/logos/bonfire-logo-full.svg" alt="Bonfire" />
    </a>
  </header>

  <main>
    <h1>Get in touch</h1>
    <p class="lead">
      Contact Bonfire if you're a nonprofit, want to collaborate on AI projects, or know James.
    </p>

    <div id="form-region">
      <form class="card" id="contact-form" novalidate>
        <div class="field">
          <label for="name">Name</label>
          <input class="input" id="name" name="name" type="text" maxlength="120" autocomplete="name" required />
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input class="input" id="email" name="email" type="email" maxlength="254" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="message">Message</label>
          <textarea class="textarea" id="message" name="message" rows="6" maxlength="2000" required></textarea>
          <div class="char-count" id="char-count">0 / 2000</div>
        </div>

        <input class="honeypot" type="text" name="hp_url" tabindex="-1" autocomplete="off" aria-hidden="true" />

        <div class="turnstile-wrap">
          <div class="cf-turnstile" data-sitekey="YOUR_TURNSTILE_SITE_KEY_HERE" data-theme="light"></div>
        </div>

        <button class="btn btn-primary" id="submit-btn" type="submit">Send message</button>

        <div class="status" id="status" role="status" aria-live="polite"></div>
      </form>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 2: Visual sanity check in the browser**

From a separate terminal:

```bash
cd "/Users/jameswilliamson/Agent/Misc/BF Website" && python3 -m http.server 5190
```

Visit `http://localhost:5190/contact.html`. Expected: clean light page, top bar with "Back" link + Bonfire wordmark, centered title "Get in touch", lead paragraph, white form card with Name / Email / Message fields, char counter showing `0 / 2000`, Turnstile widget either renders an error (because the site key is the sentinel) or shows nothing — both are fine, the real widget arrives in Task 13. Send button at the bottom.

Stop the server with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add contact.html && git commit -m "Add contact page HTML and styles"
```

---

## Task 9: Contact page submit script

**Files:**
- Modify: `contact.html` — append a `<script>` block immediately before `</body>`.

- [ ] **Step 1: Add the submit script**

In `contact.html`, find the closing `</body>` tag. Insert the following block on the line immediately before `</body>`:

```html
<script>
  (function () {
    const form = document.getElementById("contact-form");
    const submitBtn = document.getElementById("submit-btn");
    const statusEl = document.getElementById("status");
    const messageEl = document.getElementById("message");
    const counterEl = document.getElementById("char-count");
    const formRegion = document.getElementById("form-region");

    const MAX_MESSAGE = 2000;

    function updateCounter() {
      const len = messageEl.value.length;
      counterEl.textContent = `${len} / ${MAX_MESSAGE}`;
      counterEl.classList.toggle("over", len > MAX_MESSAGE);
    }
    messageEl.addEventListener("input", updateCounter);
    updateCounter();

    function setStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.classList.remove("error");
      if (type === "error") statusEl.classList.add("error");
    }

    function showSuccess() {
      formRegion.innerHTML = `
        <div class="success" role="status">
          <h2>Thanks — your message is on its way.</h2>
          <p>James will get back to you soon.</p>
          <a href="/">Back to home</a>
        </div>
      `;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setStatus("", null);

      const turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
      const turnstileToken = turnstileInput ? turnstileInput.value : "";

      const body = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        message: form.message.value.trim(),
        turnstileToken,
        hp_url: form.hp_url.value
      };

      // Client-side guardrails — server still validates everything.
      if (!body.name || !body.email || !body.message) {
        setStatus("Please fill in your name, email, and message.", "error");
        return;
      }
      if (!turnstileToken) {
        setStatus("Please complete the captcha.", "error");
        return;
      }
      if (body.message.length > MAX_MESSAGE) {
        setStatus(`Message is too long (${body.message.length} / ${MAX_MESSAGE}).`, "error");
        return;
      }

      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Sending…";

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        if (res.ok) {
          showSuccess();
          return;
        }

        let errMsg = "Something went wrong. Please try again.";
        try {
          const data = await res.json();
          if (data && data.error) errMsg = data.error;
        } catch { /* response had no JSON body */ }

        setStatus(errMsg, "error");
        if (window.turnstile && typeof window.turnstile.reset === "function") {
          window.turnstile.reset();
        }
      } catch {
        setStatus("Network error. Please try again.", "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });
  })();
</script>
```

- [ ] **Step 2: Verify the script loads without errors**

```bash
cd "/Users/jameswilliamson/Agent/Misc/BF Website" && python3 -m http.server 5190
```

Visit `http://localhost:5190/contact.html`. Open DevTools → Console. Expected: no JavaScript errors. Type characters into the Message field — counter updates live. Click Send without filling fields — inline error: "Please fill in your name, email, and message." Stop the server.

- [ ] **Step 3: Commit**

```bash
git add contact.html && git commit -m "Add contact form submit script with client validation"
```

---

## Task 10: Homepage Contact button

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add a CSS rule for the button**

Open `index.html`. Find the existing `p { … }` style rule (it has `font-size: 0.95rem; line-height: 1.6; …`). Insert the following CSS immediately after the closing `}` of the `p` rule, and before the `@media (max-width: 600px) { … }` block:

```css
    .hero-cta {
      display: inline-block;
      margin-top: 1.75rem;
      padding: 12px 32px;
      background: #CC6404;
      color: #fff;
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: 6px;
      border: 2px solid #CC6404;
      transition: background 0.2s ease, border-color 0.2s ease;
    }
    .hero-cta:hover {
      background: #A85003;
      border-color: #A85003;
    }
    .hero-cta:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 3px;
    }
```

(The focus ring is white on the dark hero so it's visible against the orange button; light pages use orange.)

- [ ] **Step 2: Add the button markup inside `.hero-panel`**

In `index.html`, find this block:

```html
      <p>
        25 years of helping nonprofit organizations do more with their
        CRM and MarTech investments.
      </p>
    </div>
  </section>
```

Replace it with:

```html
      <p>
        25 years of helping nonprofit organizations do more with their
        CRM and MarTech investments.
      </p>
      <a href="/contact" class="hero-cta">Contact</a>
    </div>
  </section>
```

- [ ] **Step 3: Visual check**

```bash
cd "/Users/jameswilliamson/Agent/Misc/BF Website" && python3 -m http.server 5190
```

Visit `http://localhost:5190/`. Expected: same hero as before, with an orange "Contact" button below the description paragraph. Hover darkens to `#A85003`. Tab to it from the keyboard — white focus ring with offset. Stop the server.

Note: `python3 -m http.server` doesn't resolve `/contact` to `contact.html` — that's `cleanUrls` in Vercel. Clicking the button locally will 404; on Vercel it will work.

- [ ] **Step 4: Commit**

```bash
git add index.html && git commit -m "Add Contact button to homepage hero"
```

---

## Task 11: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Bonfire Site

Static site for [buildabonfire.com](https://buildabonfire.com) with a contact form backed by a single Vercel serverless function.

## Stack

- Static HTML/CSS, no framework, no build step.
- One Node 20 serverless function at `api/contact.js` (verifies Cloudflare Turnstile, posts to a Slack incoming webhook).
- Hosted on Vercel.

## Pages

- `index.html` — homepage hero with Contact CTA.
- `contact.html` — contact form, served at `/contact` (Vercel `cleanUrls`).

## Environment variables

Set in the Vercel dashboard for **Production** and **Preview**. Pull locally with `vercel env pull`.

| Var | Required | Purpose |
|---|---|---|
| `TURNSTILE_SECRET` | yes | Cloudflare Turnstile secret. Pair with the public site key inlined in `contact.html`. |
| `SLACK_WEBHOOK_URL` | yes | Slack incoming webhook for the target channel in `buildabonfire.slack.com`. |
| `SLACK_MENTION` | no | Mention prepended to the message — `<@U01234ABC>` for a personal ping, `<!channel>` for channel-wide. Leave unset for no mention. |

### Where to get each value

- **Turnstile site key + secret**: Cloudflare dashboard → Turnstile → add a site for `buildabonfire.com`. Site key (public) goes into `contact.html`; secret key goes into Vercel.
- **Slack webhook**: in `buildabonfire.slack.com`, create a Slack app → Incoming Webhooks → add a webhook for the channel.
- **Slack member ID** (for `SLACK_MENTION`): in Slack, click your profile → ⋯ More → Copy member ID, then wrap as `<@MEMBERID>`.

## Local development

```bash
vercel link
vercel env pull
vercel dev
```

`vercel dev` serves both the static pages and `/api/contact`.

## Tests

```bash
npm test
```

Runs the function's unit tests under Node's built-in test runner (no install required beyond Node 20).

## Deploy

```bash
vercel deploy --prod --yes
```

Author and committer must be `jbw@buildabonfire.com` and that email must be verified on the team-owner Vercel account; otherwise Vercel Hobby blocks the deploy.
```

- [ ] **Step 2: Commit**

```bash
git add README.md && git commit -m "Add README with env setup and deploy notes"
```

---

## Task 12: Full test pass + branch push

**Files:** none.

- [ ] **Step 1: Run all tests**

```bash
cd "/Users/jameswilliamson/Agent/Misc/BF Website" && npm test
```

Expected: all tests across `api/_lib/validate.test.js`, `api/_lib/slack.test.js`, `api/_lib/turnstile.test.js`, `api/contact.test.js` pass. Exit code 0.

- [ ] **Step 2: Manually skim each touched file**

Read each:
- `index.html`
- `contact.html`
- `api/contact.js`
- `api/_lib/validate.js`
- `api/_lib/slack.js`
- `api/_lib/turnstile.js`
- `vercel.json`
- `package.json`
- `README.md`

Confirm: no stray `console.log` (function may keep `console.error` — intentional, lands in Vercel logs), no `TODO` comments, no `YOUR_TURNSTILE_SITE_KEY_HERE` outside `contact.html` (sentinel is OK there — Task 13 replaces it).

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/contact-page
```

Expected: branch published to `liesto/bonfire-site`.

---

## Task 13: First Vercel deploy — preview, then production

**Files:**
- Modify: `contact.html` — replace `YOUR_TURNSTILE_SITE_KEY_HERE` with the real public site key.

Before starting Task 13, James needs three things from external systems. If any are missing, pause and hand it back to him:

1. A Cloudflare Turnstile **site key** and **secret key** for `buildabonfire.com`.
2. A Slack **incoming webhook URL** for the target channel in `buildabonfire.slack.com`.
3. (Optional) James's Slack **member ID** for `SLACK_MENTION`.

- [ ] **Step 1: Confirm Vercel account once more**

```bash
vercel whoami
```

Expected: personal Bonfire-owning account.

- [ ] **Step 2: Link the repo to a new Vercel project**

```bash
cd "/Users/jameswilliamson/Agent/Misc/BF Website" && vercel link
```

Prompts: scope = personal account, link to existing project? = **No, create new**, project name = `bonfire-site`, directory = `./` (the default). This writes `.vercel/project.json` and updates `.gitignore` to exclude `.vercel/`. Do **not** pass `--yes` — wrong-account linking is a common cause of silently-broken deploys.

- [ ] **Step 3: Add env vars one at a time using Vercel's interactive prompt**

For each variable, run the command, paste the value at the prompt (never on the command line — secrets show up in shell history), and select **Production** AND **Preview** when asked which environments.

```bash
vercel env add TURNSTILE_SECRET
```

```bash
vercel env add SLACK_WEBHOOK_URL
```

```bash
vercel env add SLACK_MENTION
```

If you don't want a mention, you can skip `SLACK_MENTION` entirely — the function treats it as empty.

- [ ] **Step 4: Replace the Turnstile site key sentinel in `contact.html`**

Edit `contact.html`. Find:

```
data-sitekey="YOUR_TURNSTILE_SITE_KEY_HERE"
```

Replace with the real site key from the Turnstile dashboard:

```
data-sitekey="<the-real-site-key>"
```

The site key is public and safe to commit.

- [ ] **Step 5: Commit**

```bash
git add contact.html && git commit -m "Wire up Turnstile site key"
```

- [ ] **Step 6: Deploy to preview**

```bash
vercel deploy
```

Expected: build succeeds, prints a preview URL like `https://bonfire-site-<hash>.vercel.app`.

- [ ] **Step 7: Smoke-test the preview URL — happy path**

In a browser:

1. Visit the preview URL. Verify the homepage renders with the new Contact button.
2. Click Contact. Verify `/contact` loads with the header, title, lead text, form, and live Turnstile widget.
3. Fill in Name, Email, Message. Complete the Turnstile challenge.
4. Click "Send message". Expected: button label → "Sending…", form replaced by the success card.
5. Check the target Slack channel. Expected: a message arrives within seconds, with the mention (if `SLACK_MENTION` was set), the name, email, and message.

- [ ] **Step 8: Smoke-test the preview URL — failure paths**

1. Reload `/contact`, fill the form, but skip the Turnstile widget. Click submit. Expected: inline error "Please complete the captcha." No network request to `/api/contact`.
2. Refresh, fill everything, complete Turnstile. Open DevTools and overwrite the email field via the JS console (`document.getElementById('email').value = 'not-an-email'`), then submit. Expected: 400 from `/api/contact` with body `{"error":"Invalid input"}`, inline error rendered, form stays editable.
3. Refresh, fill everything correctly. In DevTools, set the honeypot value: `document.querySelector('[name="hp_url"]').value = 'spam'`. Submit. Expected: success card shown (silent 200), but **no Slack message arrives**.

- [ ] **Step 9: Deploy to production**

```bash
vercel deploy --prod --yes
```

Expected: prints a production URL. With `--prod`, this also updates the production alias for the project's primary `*.vercel.app` URL.

- [ ] **Step 10: Verify the production deployment is the one you just shipped**

```bash
vercel ls bonfire-site | head -3
```

Expected: the topmost deployment matches the URL from Step 9 with status `Ready`. (A `curl 200` against the production URL is not proof — old deploys also return 200. Match the deployment ID.)

- [ ] **Step 11: Smoke-test the production `.vercel.app` URL**

Repeat Step 7 (happy path) on the production URL. Expected: full flow works end-to-end on production, Slack message arrives.

---

## Task 14: DNS cutover and merge to main

**Files:**
- Delete: `CNAME`

- [ ] **Step 1: Add `buildabonfire.com` as a custom domain in Vercel**

In the Vercel dashboard: project `bonfire-site` → Settings → Domains → Add → `buildabonfire.com`. Vercel will display the DNS records you need at the registrar (typically an A record to a Vercel IP, plus a CNAME for `www`).

- [ ] **Step 2: Update DNS at the registrar**

At the `buildabonfire.com` registrar (wherever the domain is registered), replace the existing GitHub Pages records with the records Vercel showed in Step 1. Set TTL ≤ 300s so propagation is fast.

- [ ] **Step 3: Wait for HTTPS to provision**

Refresh the Vercel domain panel every minute or two. When the domain shows "Valid Configuration" and "SSL: Active", HTTPS is live. Usually takes a few minutes after DNS resolves to Vercel.

- [ ] **Step 4: Smoke-test on `https://buildabonfire.com`**

Repeat the happy-path test from Task 13 Step 7 on `https://buildabonfire.com`. Expected: form works end-to-end, Slack message arrives, deployment ID matches the production deployment.

- [ ] **Step 5: Disable GitHub Pages**

In a browser: open `https://github.com/liesto/bonfire-site/settings/pages`. Set "Source" to **None** (or "Disabled"). Confirm. From this point on, the only host for `buildabonfire.com` is Vercel.

- [ ] **Step 6: Delete the CNAME file**

```bash
cd "/Users/jameswilliamson/Agent/Misc/BF Website" && git rm CNAME
git commit -m "Remove CNAME after DNS cutover to Vercel"
```

- [ ] **Step 7: Push the branch**

```bash
git push
```

- [ ] **Step 8: Open a PR on GitHub**

```bash
gh pr create --base main --head feat/contact-page --title "Contact page + Vercel migration" --body "Implements the contact form (Turnstile + Slack) and migrates hosting from GitHub Pages to Vercel. Spec: docs/superpowers/specs/2026-05-28-contact-page-design.md  Plan: docs/superpowers/plans/2026-05-28-contact-page.md"
```

(Or open the PR in the GitHub UI if `gh` isn't authed.)

- [ ] **Step 9: Merge locally (NOT via `gh pr merge`)**

Per global CLAUDE.md, `gh pr merge` sets the committer to `GitHub <noreply@github.com>` and breaks Vercel Hobby deploys. Merge locally:

```bash
git checkout main && git pull && git merge --no-ff feat/contact-page && git push
```

- [ ] **Step 10: Verify the post-merge deploy**

Vercel auto-deploys on push to `main`. Wait for it to finish (~30s), then:

```bash
vercel ls bonfire-site | head -3
```

Expected: a new deployment from `main` is now the production target. Hit `https://buildabonfire.com` one more time and verify the form still works end-to-end.

---

## Out of scope (post-v1)

These belong in future plans, not this one:

- Email delivery as a second sink in `api/contact.js` (deferred — easy add later).
- Rate limiting (revisit if abuse appears in Slack).
- AI projects portfolio page (next week — separate plan).
- Migration to Next.js (revisit when portfolio needs interactivity that's awkward in raw HTML).

---

## Final self-review checklist (run before opening the PR)

- [ ] `npm test` passes with no warnings.
- [ ] `YOUR_TURNSTILE_SITE_KEY_HERE` no longer appears anywhere in the repo (`grep -r YOUR_TURNSTILE bonfire-site/` returns nothing).
- [ ] Both `index.html` and `contact.html` render without console errors in a real browser.
- [ ] Slack channel received at least one test submission and (if configured) the mention pinged correctly.
- [ ] `buildabonfire.com` is served by Vercel; GitHub Pages is disabled; `CNAME` is deleted.
- [ ] Final production deployment ID on `vercel ls bonfire-site` matches what's live.
