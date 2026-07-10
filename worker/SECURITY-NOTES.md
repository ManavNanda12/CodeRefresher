# Worker security notes

Record of the hardening pass and the operational steps it now requires. Keep this
in sync when the auth/rate-limit model changes.

## ⚠️ Required before deploy

1. **Bind a KV namespace named `RATE_LIMIT`.** The limiter is now **fail-closed**
   (`rate-limit.js`): if `RATE_LIMIT` is not bound, every rate-limited endpoint
   (evaluate, hint, followup, interview, resume, register, recover, delete, share,
   and the RAG/embed endpoints) returns **429**. This is deliberate — the old
   fail-open behaviour silently waved abuse through to paid AI/email paths. Without
   the binding the app's AI features will not serve traffic.
   ```
   wrangler kv namespace create RATE_LIMIT
   # add the returned id under [[kv_namespaces]] binding = "RATE_LIMIT"
   ```

2. **(Optional) `WELCOME_DAILY_CAP`** — hard ceiling on welcome emails triggered
   per UTC day across all IPs (default 200). Bounds worst-case unsolicited mail
   under distributed abuse. Set as a plain var to override.

## Fixed in this pass

| Ref | Endpoint / file | Change |
|-----|-----------------|--------|
| H1/H3 | `rate-limit.js` | Fail-closed when `RATE_LIMIT` unbound (was fail-open). |
| H3 | `worker.js`, `rag-demo.js`, `embed-demo.js` | Added rate limiting (`rag`, 40/hr) to `embed-demo` + `rag-*` (were unthrottled); capped notes (≤100 × ≤2000 chars) and questions (≤2000 chars) before the paid embed/LLM/Vectorize calls. |
| H2 | `welcome-dispatch.js` | Global daily welcome-email budget (`WELCOME_DAILY_CAP`). Per-IP `register` limit already caps a single source; this bounds distributed abuse. |
| H4 | `delete-account.js` | Derivable `cr_<8hex>` code is now accepted **only** for accounts with no stored recovery code. Accounts with a real recovery code require exactly that. |
| M1 | `leaderboard.js` | Public display name no longer derives from the email local-part; falls back to the generated alias. |
| M3 | `register.js`, `email-unsubscribe.js`, `admin-users.js`, `scripts/send-*.mjs` | Unsubscribe now authorized by a stored random `unsubToken` (minted at registration, backfilled by the admin export). Derivable code accepted only for records that predate the token. |

Note on M1: leaderboard entries stored with an old email-derived name persist in the
`leaderboard` KV blob until that user next syncs (which re-computes the entry).

## Residual — needs operational action (not a safe pure-code fix)

- **M2 — legacy accounts readable/writable by userId alone.** `security.js`
  `requireToken()` still allows access to accounts that have no `tokenHash`
  (back-compat for un-migrated users). A trust-on-first-use auto-bind was
  considered and **rejected**: on a tokenless account it would let whoever calls
  first (possibly an attacker who knows the UUID) bind their own token and lock
  out the real owner — converting info-disclosure into account takeover.
  Practical exploitability is low today because full UUIDs aren't published (the
  leaderboard exposes only the first 12 hex, not the dashed KV key).
  **Recommended fix:** run a migration that forces clients to re-register (minting
  a `tokenHash` for every active account), then flip `requireToken` to deny
  tokenless access. Track the tokenless count via the admin export first.

- **M4 — `/api/admin/users` returns the full PII table behind one static bearer.**
  The secret is compared in constant time and the email is required for outreach,
  so it can't be removed. **Recommended:** rotate `ADMIN_SECRET` on a schedule,
  scope it to the CI that needs it, and consider splitting the outreach export
  (email + unsubToken only) from any fuller PII dump.
