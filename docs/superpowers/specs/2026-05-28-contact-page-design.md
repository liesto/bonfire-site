# Bonfire Contact Page — Design

**Date:** 2026-05-28
**Author:** James Williamson
**Status:** Approved, ready for implementation plan

## Goal

Add a Contact button to the Bonfire homepage and a branded contact subpage with a Name / Email / Message form, Cloudflare Turnstile captcha, and Slack delivery. Move hosting from GitHub Pages to Vercel so the form can have a server-side endpoint.

The change also establishes the file layout for next week's interactive AI projects portfolio page.

## Decisions

### Hosting: Vercel (move whole site)

The site moves from GitHub Pages to Vercel. Reasons:

- Form needs a server-side endpoint for Turnstile verification and the Slack webhook secret. GitHub Pages can't host one.
- Single platform is simpler than GitHub Pages + a separate function host (no CORS, one deploy, one set of env vars).
- Vercel deploys are already part of the user's workflow.
- The portfolio page coming next week can grow into Next.js on the same project if interactivity demands it.

### No framework

Hand-authored HTML/CSS, no build step — same approach as today. The site is two pages; a bundler would add more friction than value. If next week's portfolio page outgrows raw HTML, that's the moment to introduce Next.js, not now.

### Delivery: Slack only (v1)

POST to a Slack incoming webhook in the `buildabonfire.slack.com` workspace. Email is deferred — the function is structured so adding Resend later is a small change.

### Contact page tone: light, content-focused

Light background (white / `--bg-subtle`), dark text, brand wordmark up top. The homepage's dark photo hero doesn't repeat here — the contact page is a utility page where the form should read clearly. The brand allows both light and dark surfaces; this is the better choice for a form.

### Captcha: Cloudflare Turnstile

Standard widget on the page, server-side verification in the function. Site key is public (inlined in HTML); secret is server-only.

## File-by-file changes

```
bonfire-site/
  index.html                                            # MODIFY: add Contact button
  contact.html                                          # NEW
  api/
    contact.js                                          # NEW: serverless function
  vercel.json                                           # NEW: clean URL routing, headers
  README.md                                             # NEW: env var + deploy docs
  docs/superpowers/specs/2026-05-28-contact-page-design.md  # NEW: this spec
  CNAME                                                 # DELETE after DNS cutover
```

Existing `BF-Home.jpg`, `favicon.png`, `logo.png`, and `assets/` are untouched.

### `index.html` (modify)

Add a single primary button inside `.hero-panel`, immediately after the `<p>` element:

```html
<a href="/contact" class="btn btn-primary">Contact</a>
```

Inline the `.btn` and `.btn-primary` styles from the brand skill into the existing `<style>` block (keeping the page self-contained, no external CSS). Center the button under the paragraph with `margin-top: 1.5rem`. Hover, focus-visible, and active states per the brand spec.

### `contact.html` (new)

Self-contained HTML/CSS, no external dependencies except the Turnstile script and the brand logo from the CDN URL in the skill.

**Layout (top to bottom, single column, max-width ~720px, generous vertical spacing):**

1. **Header bar** (full width, white background, 1px bottom border `--border`):
   - Left: `← Back` ghost link → `/`. Inline SVG chevron icon, 1.5px stroke.
   - Right: Bonfire wordmark from CDN (`bonfire-logo-full.svg`), 32px tall, linked to `/`.
2. **Title section** (centered, top padding `--space-3xl`):
   - `<h1>Get in touch</h1>` — brand heading scale, weight 600.
   - Lead `<p>`: *"Contact Bonfire if you're a nonprofit, want to collaborate on AI projects, or know James."*
3. **Form card** (`.card` style, white surface, 8px radius, `--border`, max-width 560px, centered, padding `--space-xl`):
   - `<label>Name</label>` + text input — required, maxlength 120.
   - `<label>Email</label>` + email input — required, maxlength 254.
   - `<label>Message</label>` + textarea — required, 6 rows, maxlength 2000, char counter below.
   - Honeypot input `<input name="hp_url" type="text" tabindex="-1" autocomplete="off">` hidden via `position: absolute; left: -9999px;`.
   - Turnstile widget (`<div class="cf-turnstile" data-sitekey="…" data-theme="light"></div>`).
   - Submit button `.btn-primary`, full width on mobile, auto-width on desktop. Disabled state during submit, label changes to "Sending…".
   - Status `<div aria-live="polite" role="status">` below the button for inline error messaging.

**Submit handling (inline `<script>`):**

- Prevent native form submit.
- POST JSON `{name, email, message, turnstileToken, hp_url}` to `/api/contact`.
- On 200: replace the form card with a success card — *"Thanks — your message is on its way. James will get back to you soon."* + a link back to home.
- On 4xx/5xx: show the response's `error` message inline (color `--color-error`), re-enable the submit button, reset Turnstile so the user can retry.

**Accessibility:**

- Real `<label for>` elements above each field.
- `aria-invalid="true"` on fields that fail validation.
- `aria-live="polite"` on the status region.
- Focus states use the brand orange ring (3px @ 15% opacity).
- All interactive targets ≥ 44×44px.
- Color contrast WCAG AA throughout.

### `api/contact.js` (new)

Node 20 serverless function. No npm dependencies — uses `fetch` and `node:` builtins only.

**Request contract:**

```
POST /api/contact
Content-Type: application/json

{
  "name": "string (1-120)",
  "email": "string (valid email, max 254)",
  "message": "string (1-2000)",
  "turnstileToken": "string",
  "hp_url": "string (should be empty)"
}
```

**Response contract:**

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true}` | Success, message delivered to Slack |
| 200 | `{"ok": true}` | Honeypot filled (silent discard — don't tell the bot) |
| 400 | `{"error": "Invalid input"}` | Missing/malformed fields |
| 400 | `{"error": "Captcha failed"}` | Turnstile verification failed |
| 405 | `{"error": "Method not allowed"}` | Non-POST request |
| 502 | `{"error": "Delivery failed"}` | Slack webhook returned non-2xx |

**Processing steps:**

1. Reject non-POST methods with 405.
2. Parse JSON body; reject malformed JSON with 400.
3. If `hp_url` is a non-empty string → return 200 silently. Do not call Turnstile or Slack.
4. Validate fields:
   - `name`: string, 1–120 chars after trim.
   - `email`: string, matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, ≤ 254 chars.
   - `message`: string, 1–2000 chars after trim.
   - `turnstileToken`: non-empty string.
   - Any failure → 400 `{error: "Invalid input"}`.
5. Verify Turnstile: POST form-encoded `secret` + `response` (+ optional `remoteip` from `x-forwarded-for`) to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. If `success !== true` → 400 `{error: "Captcha failed"}`.
6. POST to `SLACK_WEBHOOK_URL` with this payload:
   ```json
   {
     "text": "<mention> New Bonfire contact form\n*Name:* <name>\n*Email:* <email>\n*Message:*\n<message>"
   }
   ```
   `<mention>` is `process.env.SLACK_MENTION ?? ""` (with a trailing space when present). Newlines preserved; user input is escaped for Slack's mrkdwn formatting (`&`, `<`, `>` → entity-encoded). Slack's incoming-webhook format does the rest.
7. If Slack returns non-2xx → 502 `{error: "Delivery failed"}`. Log the status to the function logs (no body — may contain sensitive context).
8. On Slack 2xx → 200 `{ok: true}`.

**Why no rate limiting in v1:** Turnstile + honeypot + low traffic + no public endpoint discovery path. If abuse appears, add Vercel KV-backed token bucket later.

### `vercel.json` (new)

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

`cleanUrls: true` serves `contact.html` at `/contact`. No rewrites needed for the function — `/api/contact.js` is auto-routed.

### `README.md` (new)

Documents: local dev (`vercel dev`), env vars (with one-liner on how to grab each one — Turnstile dashboard, Slack app config, Slack user ID lookup), and deploy commands.

## Environment variables

Set in Vercel dashboard for **Production** and **Preview** environments. Pulled locally with `vercel env pull`.

| Var | Scope | Required | Notes |
|---|---|---|---|
| `TURNSTILE_SECRET` | server | yes | From Cloudflare Turnstile dashboard. Pair this with the site key inlined in `contact.html`. |
| `SLACK_WEBHOOK_URL` | server | yes | Incoming webhook for the target channel in `buildabonfire.slack.com`. Determines which channel receives the message. |
| `SLACK_MENTION` | server | no | E.g. `<@U01234ABC>` to ping James, `<!channel>` for channel-wide. Empty → no mention. |

Turnstile **site key** (public) is inlined directly in `contact.html`. It's not a secret.

## Deploy + cutover plan

1. **Verify Vercel account.** Run `vercel whoami` — must be the personal Bonfire-owning account, not `jwilliamson-1933` (USMS) or any PAS account. Confirm `jbw@buildabonfire.com` is verified on `vercel.com/account` for that team (per global CLAUDE.md — required for Hobby deploys).
2. **Link the repo.** `cd` into the repo, `vercel link`, pick the personal scope, create a new project named `bonfire-site`.
3. **Set env vars** in the Vercel dashboard (Production + Preview). Use Vercel's CLI prompts (`vercel env add <name>`) to avoid pasting secrets on the command line.
4. **Deploy to preview.** `vercel deploy`. Smoke test on the preview URL: homepage → Contact button → fill form → Turnstile completes → submit → Slack DM lands → success state renders.
5. **Deploy to production.** `vercel deploy --prod --yes`. Test on the assigned `bonfire-site-*.vercel.app` URL.
6. **Add custom domain.** In Vercel project settings, add `buildabonfire.com`. Vercel will show the DNS records needed.
7. **Update DNS** at the registrar to point `buildabonfire.com` at Vercel.
8. **Wait for HTTPS** to provision on Vercel (usually a few minutes).
9. **Verify** the form works end-to-end on `buildabonfire.com`.
10. **Disable GitHub Pages** in the `liesto/bonfire-site` repo settings. Delete the `CNAME` file in a follow-up commit.

## Testing approach

Manual end-to-end (this is two static pages and one function — automated tests would be more scaffolding than the feature is worth):

- **Happy path**: fill form correctly, Turnstile completes, submit, verify Slack message arrives with all three fields and the mention (if configured).
- **Validation failures**: empty fields, invalid email, oversized message → inline 400 error, form stays editable.
- **Captcha failure**: submit without completing Turnstile, or with a stale token → 400 "Captcha failed".
- **Honeypot**: fill the hidden `hp_url` via DevTools, submit → 200 OK but no Slack message.
- **Network failure**: temporarily set `SLACK_WEBHOOK_URL` to an invalid URL → 502 error rendered inline.
- **Mobile**: form usable on a 375px-wide viewport, submit button full width, touch targets ≥ 44px.
- **Keyboard**: full flow without a mouse — tab through fields, complete Turnstile (it supports keyboard), submit.
- **No-JS fallback**: not supported. The form requires JavaScript for Turnstile and for the fetch submit. Acceptable for a contact form on a brochure site.

## Out of scope (v1)

- Email delivery (deferred — add Resend as a second sink in the function once the inbox setup is done).
- Rate limiting (revisit if abuse appears).
- AI projects portfolio page (next week — file layout already accommodates `portfolio.html`).
- Next.js migration (revisit when portfolio needs interactivity that's awkward in raw HTML).
- Analytics on form submissions (no requirement raised).

## Open setup tasks for the user (not blockers for implementation)

These are credentials/config James needs to create before the first deploy works. None are blockers for writing code — the implementation can land and we wire up the env vars at deploy time.

- Create a Turnstile site + secret key in the Cloudflare dashboard.
- Create a Slack app + incoming webhook in `buildabonfire.slack.com`, scoped to the channel where contact submissions should land.
- Grab James's Slack user ID from his Slack profile (for `SLACK_MENTION`).
