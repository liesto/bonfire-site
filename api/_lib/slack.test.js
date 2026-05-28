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
  assert.match(payload.text, /^<@U01> /);
  assert.match(payload.text, /\*Name:\* &lt;script&gt;/);
  assert.match(payload.text, /x &amp; y/);
});
