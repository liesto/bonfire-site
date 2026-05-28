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
