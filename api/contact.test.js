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
