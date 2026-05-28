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
