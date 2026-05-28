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
