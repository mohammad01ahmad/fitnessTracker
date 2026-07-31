# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-user WhatsApp calorie tracker. Ahmad texts `/calories 200g rice 50g beef lunch` to his own WhatsApp self-chat; a Baileys socket in a long-running Node process picks it up, an LLM extracts structured nutrition, the row lands in Supabase, and a confirmation is sent back on the same socket. `dashboard/` is meant to read Supabase and chart intake against fixed targets (3000 kcal / 120g protein) but is still unmodified create-next-app boilerplate.

The original `PRD.md` was deleted from the working tree but is still in git (`git show HEAD:PRD.md`). Code comments cite it as "PRD §8", "PRD §10". It documents intent, not current reality — see Drift below.

## Commands

```bash
# backend
cd backend
npm start                            # runs the Baileys socket (src/whatsapp/socket.ts) — this is the app
npm run typecheck                    # tsc --noEmit; there is no build step
node --env-file=.env tests/test-db.ts # insert lands, user_id set, duplicate rejected — hits the real Supabase table
npm test                             # = node tests/test-backoff.ts — pure unit test of reconnect.ts's backoff policy, no network

# dashboard
cd dashboard
npm run dev
npm run lint
```

No test framework. Both are plain assert scripts, not a suite. `test-db.ts` hits the real Supabase table and cleans up after itself, so it's run manually, not via `npm test`. `test-backoff.ts` is pure (see Connection lifecycle & reliability below) and is what `npm test` runs.

## Node runs TypeScript directly — no build

`npm start` is `node --env-file=.env src/whatsapp/socket.ts`. Node strips types at runtime, which is why `tsconfig.json` sets `erasableSyntaxOnly` and `allowImportingTsExtensions`, and why **every relative import must carry the `.ts` extension** (`./messageHandler.ts`). Enums, namespaces, parameter properties, and anything else that emits code will fail at runtime, not just typecheck.

## Flow

`socket.ts` is entry point, event wiring, and orchestration in one file:

1. `messages.upsert` fires → skip unless `type === 'notify'` (otherwise history replays on every reconnect and re-logs everything).
2. Self-chat filter: `m.key.fromMe` **and** the message's JID — checking both `m.key.remoteJid` and the v7 `remoteJidAlt` fallback — matches one of `sock.user.id` / `.lid` / `.phoneNumber`. Both halves matter — without them any chat could log meals and burn the API key. All three JID forms are checked because Baileys v7 migrated self-identification to LID, and which field holds the phone-number form vs. the LID form depends on which one `sock.user.id` already is — miss one and the filter can silently stop matching.
3. `messageHandler.ts` regex-matches `/calories\b` (case-insensitive) and returns the stripped text, or `undefined`.
4. `openrouter_client.ts` → OpenRouter chat/completions with a strict `json_schema` response format and a 30s timeout, returns `Nutrition`.
5. `db/meals.ts` inserts **before** replying — a confirmation must mean the row landed.

Idempotency is the unique index `meals_whatsapp_message_id_key` in Postgres, not a pre-read: `populateTable` catches error code `23505` and returns `null`, and `socket.ts` treats `null` as "already logged, don't confirm twice". Don't replace this with a select-then-insert. `tests/test-db.ts` is what proves the index still exists — if it's ever dropped, idempotency silently becomes a no-op and every duplicate double-confirms.

If the LLM call or the insert throws, the per-message `catch` sends a generic "something went wrong" reply, not `error.message` — provider/DB error text can carry request details and shouldn't land in the chat log. That send is itself `.catch()`'d: if the socket is already dead (plausible, since something just failed), an unprotected `await` there would escape the `catch` block as an unhandled rejection and take the whole process down over one bad meal log.

## Connection lifecycle & reliability

Added after a 2026-07-29 incident: an open→close flap sustained ~400k reconnect attempts in 12h, logging straight to the VM's disk. `reconnect.ts`, `fatal.ts`, and `whatsapp/constants.ts` exist because of that incident — treat their logic as load-bearing, not incidental.

- `reconnect.ts` exports a pure function, `reconnectPlan`, kept free of any Baileys/socket dependency so it's unit-testable without a live connection — `tests/test-backoff.ts` (`npm test`) replays worst-case loops and asserts the attempt count stays bounded.
- Backoff keys off the **raw status code** on the close error, not `DisconnectReason` — WA's 405 rate-limit response isn't in that enum. Three status groups are terminal (`reconnect: false`) instead of retried forever: 401/403/419 (`reason: 'creds'`, dead credentials), 500/411 (`reason: 'session'`, broken session), and 440 (`reason: 'replaced'`, another session took over the same linked device — retrying immediately just starts a replace-each-other ping-pong, so this one gets a 5-minute cooldown instead of an immediate retry).
- `fatal.ts` is the only place allowed to call `process.exit`. `retryable: false` → `exit(0)`, which `docker-compose.yml`'s `restart: on-failure:10` treats as "stay down, needs a human" (a `0` exit never restarts under `on-failure`). `retryable: true` → `exit(1)` after an optional in-app `delayMs` sleep, so a retry has real distance before Docker's own restart backoff (capped ~1 minute) kicks in.
- `socket.ts` runs a 15-minute watchdog (`WATCHDOG_IDLE_MS`/`WATCHDOG_CHECK_MS` in `constants.ts`) because a wedged-but-not-closed socket throws nothing for `index.js`'s global `uncaughtException`/`unhandledRejection` handlers to catch — without it, that failure mode is silent forever.
- `fetchLatestWaWebVersion` only runs on a fresh start or right after an observed 405, not on every reconnect, and is capped at a 5s timeout. It doesn't throw internally (it falls back to Baileys' pinned version on any failure), but with no timeout a slow/unreachable `web.whatsapp.com` could stall every reconnect attempt.
- `makeWASocket` explicitly sets `getMessage` (a stub — no message store is kept, so resend requests can't be fulfilled; see the `ponytail:` comment in `socket.ts` for the upgrade path), `shouldSyncHistoryMessage: () => false` (the `type !== 'notify'` filter discards replayed history anyway — this stops it being downloaded first, pure waste on 1GB RAM), and `markOnlineOnConnect: false` (default `true` suppresses phone push notifications, including for this bot's own confirmations).

## Data + secrets

Backend writes go through `db/client.ts` with the **service role key** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_USER_ID` in `backend/.env`), which bypasses RLS. It throws at boot if any is missing. Never give that key a `NEXT_PUBLIC_` prefix — that prefix means "shipped to the browser".

Writes go to **`meals`**. `user_id` is a uuid FK to `auth.users` holding Ahmad's own auth user id; it's static, so `populateTable` injects it from `USER_ID` rather than threading it through callers — it is deliberately not part of `MealRow`.

The column for Breakfast/Lunch/Dinner/Snack is **`meal_time`**, not `meal_type`. It's a poor name for what it holds; the code matches the DB rather than the other way round.

`meals_testing` still exists but nothing writes to it. `carbs_g`/`fat_g` columns exist but `Nutrition` dropped them, so they're always null. `logged_at` has no default and nothing sets it — also always null; `created_at` (default `now()`) is the real row timestamp.

`backend/auth_session/` holds Baileys credentials — gitignored, treat as a secret. Deleting it forces a new QR-code link on next start (the QR prints to the terminal).

The `supabase` MCP server is configured in `.mcp.json` — prefer it over guessing at schema.

## Drift to know about

These are inconsistencies in the tree, not things to "fix" unasked — but don't trust the stale side:

- **PRD says Claude Haiku via forced tool use; the code calls OpenRouter (`openai/gpt-oss-20b`).** `@anthropic-ai/sdk` is a dependency but unused.
- **`claude/gemini_client.ts` is dead and broken** — it imports `Nutrition` from `openrouter_client.ts`, but that type moved to `utils/constants.ts`. Only `openrouter_client.ts` is wired in.
- **`Nutrition` dropped `carbs_g`/`fat_g`** and added `meal_time`; PRD and `gemini_client.ts` still have the old shape.
- **RLS is on for `meals` with zero policies.** The backend is unaffected (service role bypasses RLS), but the dashboard using the publishable key will read zero rows until a policy exists.
- **`db/server.ts` and `db/middleware.ts` are Next.js Supabase SSR helpers sitting in `backend/`** — they import `next/headers` and reference `NextRequest`/`NextResponse` without importing them. They belong to the dashboard and don't typecheck where they are.
- **`src/index.js`, `src/config/targets.js`, `src/utils/logger.js` are empty files** from the PRD's planned layout.

## Dashboard

`dashboard/AGENTS.md` (mirrored into `dashboard/CLAUDE.md`) states: this Next.js version has breaking changes vs. training data — read `node_modules/next/dist/docs/` before writing dashboard code rather than relying on remembered APIs.

## Deferred work

**Replace `useMultiFileAuthState` (`socket.ts`) with a Supabase-backed auth state.** It's genuinely not production-safe per the Baileys docs, and it rewrites to disk on every message, not just on reconnect. It's also the single largest change of everything flagged in the 2026-07 reliability audit — a new auth-state implementation modeled on Baileys' own `use-multi-file-auth-state.ts` reference, which must carry the `lid-mapping`/`device-list`/`tctoken` keys the v7 LID migration added (the bundled implementation handles these; a custom one must implement them explicitly or pairing breaks).

This was deliberately not bundled with the reliability hardening pass described above (bounded restarts, terminal-state handling, the watchdog, LID/JID matching). Reasoning: the two concerns it's meant to address — unbounded restarts hammering the disk, and losing the session on restart — are already covered by that hardening pass and by `docker-compose.yml`'s existing `auth_session` bind mount. At current single-user message volume this is a real-but-slow-burn IO concern, not a storm-recurrence risk, so it was scoped out as its own follow-up rather than bundled in. Pull it forward if that trade-off stops holding — e.g. IO actually shows up as a problem, or message volume increases materially.
