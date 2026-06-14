# Weekly Email Digest — Setup

Sends each user a weekly progress recap + their weakest module + a Focus Round CTA.

**Why it's split this way:** Cloudflare Workers can't open raw SMTP connections, so
the *sending* runs from Node in a **GitHub Actions cron**, using your SMTP creds. The
Worker only exposes a secured endpoint that hands over the user list.

```
GitHub Actions (Mon 09:00 UTC)
   └─ node scripts/send-weekly-digest.mjs
        ├─ GET  {WORKER}/api/admin/users   (Bearer ADMIN_SECRET)   ← read users from KV
        └─ SMTP (nodemailer) per user      → weekly digest email
             (footer) → GET {WORKER}/api/email/unsubscribe         ← one-click opt-out
```

---

## 1. Add the two worker endpoints

Copy `worker/admin-users.js` and `worker/email-unsubscribe.js` into your worker
project, then add to `worker.js`:

```js
import { handleAdminUsers } from "./admin-users.js";
import { handleUnsubscribe } from "./email-unsubscribe.js";

// inside fetch(), alongside the other routes:
else if (url.pathname === "/api/admin/users" && request.method === "GET") {
  return handleAdminUsers(request, env);
}
else if (url.pathname === "/api/email/unsubscribe" && request.method === "GET") {
  return handleUnsubscribe(request, env);
}
```

## 2. Set the worker's admin secret

```bash
# pick a long random string; the GitHub Action must use the SAME value
npx wrangler secret put ADMIN_SECRET
```

Verify (replace SECRET):

```bash
curl https://coderefresherworker.manavnanda2404.workers.dev/api/admin/users \
  -H "Authorization: Bearer SECRET"
# → {"success":true,"count":N,"users":[...]}
```

## 3. Add GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret         | Value                                                              |
|----------------|-------------------------------------------------------------------|
| `WORKER_BASE`  | `https://coderefresherworker.manavnanda2404.workers.dev`          |
| `ADMIN_SECRET` | same string you set on the worker                                 |
| `SMTP_FROM`    | `CodeRefresher <progress@yourdomain.com>`                         |
| `SMTP_HOST`    | your SMTP host (e.g. `smtp.gmail.com`, `smtp-relay.brevo.com`)    |
| `SMTP_PORT`    | `587` (STARTTLS) or `465` (SSL)                                   |
| `SMTP_USER`    | SMTP username                                                     |
| `SMTP_PASS`    | SMTP password / app password                                     |
| `SMTP_SECURE`  | `true` only if using port 465 (optional; auto-inferred otherwise) |
| `APP_BASE_URL` | your site URL, e.g. `https://devrefresher.app` (used in links)    |

> Gmail: you must use an **App Password** (with 2FA on), not your account password,
> and `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.

## 4. Test before going live

The workflow has a manual trigger that **defaults to dry-run** (logs recipients, sends
nothing):

- GitHub → **Actions → Weekly Progress Digest → Run workflow** → leave "Dry run" checked.
- Check the logs: `Fetched N users … [dry-run] → you@example.com`.

Then run it once with **Dry run unchecked** to send for real. The scheduled Monday run
always sends for real.

Run locally instead:

```bash
npm install --no-save nodemailer
WORKER_BASE=... ADMIN_SECRET=... SMTP_FROM=... SMTP_HOST=... SMTP_PORT=587 \
SMTP_USER=... SMTP_PASS=... DRY_RUN=true node scripts/send-weekly-digest.mjs
```

---

## Deliverability (you picked "scale: not sure")

The script is **transport-swappable**. Start on SMTP; if you grow or land in spam folders,
flip to a real provider with zero code changes:

1. Verify a domain in Resend (adds SPF/DKIM DNS records).
2. Add GitHub secrets `EMAIL_PROVIDER=resend` and `RESEND_API_KEY=...`.

That's it — the script uses Resend's HTTP API instead of SMTP. Either way:

- Keep `SMTP_FROM` on a **domain you control** with SPF/DKIM set, or you'll hit spam.
- Personal Gmail/host SMTP has low daily caps (~500/day) — fine for now, not for scale.
- Every email carries an unsubscribe link + `List-Unsubscribe` header (good-practice / required for bulk).

## What gets sent

- Only users with **≥1 recorded round** and **not unsubscribed**.
- Content: rounds this week, per-arena readiness, weakest module, Focus Round CTA.
- Unsubscribing sets `unsubscribed:true` on the KV record; progress is untouched.
