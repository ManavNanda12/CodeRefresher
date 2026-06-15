# Cloudflare KV Setup — Smart Dashboard

The dashboard's source of truth is one **KV namespace** bound to the same Worker
that already serves `/api/evaluate`. Follow these steps in the Cloudflare dashboard
(or via Wrangler CLI — both shown).

---

## 1. Create the KV namespace

**Dashboard:**
1. Cloudflare Dashboard → **Workers & Pages** → **KV**.
2. Click **Create a namespace**.
3. Name it `CODEREFRESHER_PROGRESS` → **Add**.

**Wrangler CLI (alternative):**
```bash
npx wrangler kv namespace create CODEREFRESHER_PROGRESS
# copy the printed "id" — you'll paste it into wrangler.toml below
```

---

## 2. Bind it to your Worker as `PROGRESS_KV`

Your existing `/api/evaluate` lives in the `coderefresherworker` Worker — bind the
namespace there so `env.PROGRESS_KV` is available in code.

**Dashboard:**
1. Workers & Pages → open **coderefresherworker** → **Settings** → **Bindings**.
2. **Add binding** → **KV namespace**.
3. Variable name: `PROGRESS_KV` · Namespace: `CODEREFRESHER_PROGRESS` → **Deploy**.

**Wrangler (`wrangler.toml`) alternative:**
```toml
[[kv_namespaces]]
binding = "PROGRESS_KV"
id = "<the id printed in step 1>"
```

---

## 3. Add the endpoints to the Worker

Your deployed worker already routes correctly (`worker.js`) and `evaluate.js` is
untouched. Only two handlers need to change; `register.js` is an optional hardening:

| File                | Change      | Why                                                          |
|---------------------|-------------|--------------------------------------------------------------|
| `worker.js`         | none        | Routes already match all four endpoints.                     |
| `evaluate.js`       | none        | Untouched.                                                   |
| `progress-sync.js`  | 🔴 replace  | Frontend posts `{ userId, round }` (per-question module data). Old version read `{userId,arena,score,total}` → 400s every sync; stored arena-level only → empty heatmap. |
| `recover.js`        | 🔴 replace  | Must return `userId`/`email` **flat** (frontend reads `res.userId`), not nested under `data`. |
| `register.js`       | 🟡 optional | Preserve progress on re-register + lockstep recovery-code formula. |
| `dashboard.js`      | 🟡 optional | Works as-is; tidier version returns a normalized empty shape for unknown users. |

> ⚠️ **Module-level is the whole point.** The new `progress-sync.js` stores
> `progress.{arena}.{overall, modules}` + full round history — that's what powers
> the heatmap and weak-spots. Sync body is `{ userId, round }`. The recovery-code
> formula (`cr_` + first 8 hex of the UUID) **must stay identical** to the client's
> `recoveryCodeFor()` in `user.service.ts`, or restore lookups won't match.

### Later additions (already wired in `worker/worker.js`)

| File | Route | Purpose |
|------|-------|---------|
| `delete-account.js` | POST `/api/user/delete` | Delete a user (recovery-code authorized) |
| `admin-users.js` | GET `/api/admin/users` | Email export (Bearer `ADMIN_SECRET`) |
| `email-unsubscribe.js` | GET `/api/email/unsubscribe` | One-click opt-out |
| `game-sync.js` | POST `/api/game/sync` · GET `/api/game/load` | Arena game state (XP/mastery/streak) under `user.game` |

> **KV write budget:** the free tier allows ~1,000 writes/day. Game state is
> **batched on the client** (debounced ~6s + flush on tab-hide) and stored inside
> the existing `user:{id}` record — so it adds no new key and rarely adds a write
> beyond the normal round sync. Storage is a non-issue (~1–2 KB/user vs 1 GB).

---

## 4. Deploy & smoke-test

```bash
# from your worker project
npx wrangler deploy

# register a user
curl -X POST https://coderefresherworker.manavnanda2404.workers.dev/api/user/register \
  -H 'Content-Type: application/json' \
  -d '{"userId":"550e8400-e29b-41d4-a716-446655440000","email":"you@example.com"}'
# → {"success":true,"recoveryCode":"cr_550e8400"}

# fetch the (empty) dashboard
curl 'https://coderefresherworker.manavnanda2404.workers.dev/api/progress/dashboard?userId=550e8400-e29b-41d4-a716-446655440000'
# → {"email":"you@example.com","arenas":{},"recentRounds":[]}
```

---

## 5. Reading user emails later (for outreach)

Emails live in each `user:{uuid}` record. To export them:

```bash
# list all user keys
npx wrangler kv key list --binding PROGRESS_KV | jq -r '.[].name | select(startswith("user:"))'

# read one record
npx wrangler kv key get "user:550e8400-..." --binding PROGRESS_KV | jq '.email'
```

> 💡 If you'll do outreach often, add a `POST /api/admin/emails` route guarded by a
> secret header that lists `user:*` keys and returns the emails — cheaper than
> scripting `kv key get` per user. (Not built yet; fast follow.)

---

## Notes on the data model

- **One key per user** (`user:{uuid}`), ~15 KB at 30 rounds — far under KV's 25 MB value limit.
- `recovery:{code}` is a tiny pointer key so restore is an O(1) lookup, not a scan.
- The client (`progress.service.ts`) and the Worker (`applyRound`) use the **same merge
  math**, so localStorage and KV stay consistent. KV always wins on dashboard load.
