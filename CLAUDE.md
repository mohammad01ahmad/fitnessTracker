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
node --env-file=.env tests/test-db.ts # the only test: insert lands, user_id set, duplicate rejected

# dashboard
cd dashboard
npm run dev
npm run lint
```

No test framework. `test-db.ts` is a plain assert script that hits the real Supabase table and cleans up after itself.

## Node runs TypeScript directly — no build

`npm start` is `node --env-file=.env src/whatsapp/socket.ts`. Node strips types at runtime, which is why `tsconfig.json` sets `erasableSyntaxOnly` and `allowImportingTsExtensions`, and why **every relative import must carry the `.ts` extension** (`./messageHandler.ts`). Enums, namespaces, parameter properties, and anything else that emits code will fail at runtime, not just typecheck.

## Flow

`socket.ts` is entry point, event wiring, and orchestration in one file:

1. `messages.upsert` fires → skip unless `type === 'notify'` (otherwise history replays on every reconnect and re-logs everything).
2. Self-chat filter: `m.key.fromMe` **and** `jidNormalizedUser(m.key.remoteJid) === own JID`. Both halves matter — without them any chat could log meals and burn the API key.
3. `messageHandler.ts` regex-matches `/calories\b` (case-insensitive) and returns the stripped text, or `undefined`.
4. `openrouter_client.ts` → OpenRouter chat/completions with a strict `json_schema` response format, returns `Nutrition`.
5. `db/meals.ts` inserts **before** replying — a confirmation must mean the row landed.

Idempotency is the unique index `meals_whatsapp_message_id_key` in Postgres, not a pre-read: `populateTable` catches error code `23505` and returns `null`, and `socket.ts` treats `null` as "already logged, don't confirm twice". Don't replace this with a select-then-insert. `tests/test-db.ts` is what proves the index still exists — if it's ever dropped, idempotency silently becomes a no-op and every duplicate double-confirms.

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
