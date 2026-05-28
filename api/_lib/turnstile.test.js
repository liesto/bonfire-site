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
