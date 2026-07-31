# Baileys Production Hardening — Audit & Fix List

**Project:** WhatsApp calorie tracker backend
**Audited files:** `socket.ts`, `reconnect.ts`, `messageHandler.ts`, `constants.ts`, `logger.js`, `client.ts`, `meals.ts`
**Audited against:** official Baileys docs (baileys.wiki — intro, migration/to-v7.0.0, socket/configuration, socket/connecting, socket/history-sync, socket/receiving-updates, socket/handling-messages) and the npm package README
**Confirmed environment:** `@whiskeysockets/baileys@7.0.0-rc13`; deployed via **Docker Compose** with `restart: unless-stopped` (no pm2); `src/index.js` already registers `uncaughtException` / `unhandledRejection` handlers that `logger.fatal` and `exit(1)`
**Context:** 2026-07-29 incident — ~400k connection attempts in 12h. Connection is currently working; this pass is about making failure modes visible, bounded, and recoverable.

---

## What is already correct — do not regress these

The current implementation is a large improvement over the README's reconnect pattern. The following are correct and deliberately designed; any refactor must preserve them:

- `closed` guard in `connection.update` — prevents multiple `close` events on one dead socket from each starting their own reconnect chain (this alone would double the loop every round).
- `STABLE_MS` / `sessionMs` logic in `reconnect.ts` — only a connection that actually *held* resets the backoff. Resetting on every `open` is what let an open→close flap sustain ~1 attempt/sec.
- Capped exponential backoff keyed off the **raw status code**, not `DisconnectReason` enumeration (405 "Connection Failure" is not in `DisconnectReason`).
- Unpaired minimum wait — each unpaired retry registers a brand-new device identity, and a burst from one IP is itself a 405 trigger.
- `reconnect.ts` kept pure and separate so the policy is testable without opening a real socket.
- Global `uncaughtException` / `unhandledRejection` handlers in `src/index.js`.
- `type !== 'notify'` filter in `messages.upsert` — ignores history replayed on reconnect.
- Insert-before-confirm ordering — a WhatsApp confirmation means the row actually landed.
- `23505` unique-violation as the idempotency check rather than a pre-read.
- Listener teardown before chaining a reconnect (though see §7 — the timing is wrong).
- Single shared pino logger passed to both app code and `makeWASocket`.
- Per-message child logger carrying `msgId` through every line.
- Fail-at-boot env validation in `client.ts`.

**The 400k in-process loop as it originally occurred cannot recur with this code.** Everything below is about remaining, different failure modes.

---

## 1. CRITICAL — the storm can reform at the container level

### What is already handled

`src/index.js` registers `uncaughtException` / `unhandledRejection` handlers that log fatally and `exit(1)`. That matters: it means a rejected `connectToWhatsApp()` promise does **not** cause a silent death. Node emits `unhandledRejection`, the handler fires, the process exits.

### The actual remaining problem

Because those handlers exit and Docker Compose is configured `restart: unless-stopped`, the recovery path is **unbounded container restarts**.

If `connectToWhatsApp()` rejects immediately on every start — WA answering 405 at the registration handshake, a disk error in `useMultiFileAuthState`, `fetchLatestWaWebVersion` failing hard — the loop becomes:

```
start → reject → unhandledRejection → exit(1) → Docker restarts → reject → ...
```

Docker applies its own exponential backoff to restarts (starting around 100ms and doubling, capped at roughly 1 minute), so this is not as fast as the original in-process storm. But capped at one minute and unbounded in count, it is still on the order of **~1,400 restarts per day**, indefinitely, with the auth-session IO of §4 on every attempt. That is the same storm at a different layer.

`restart: unless-stopped` also restarts on **any** exit, including a clean `exit(0)` — so there is currently no way for the app to say "stop, this needs a human."

### Fix 1 — make the exit code meaningful, and bound the restarts

```yaml
# docker-compose.yml
services:
  bot:
    restart: on-failure:10
```

This swaps the semantics in exactly the way this design needs:

| Exit code | `unless-stopped` (current) | `on-failure:10` (proposed) |
|---|---|---|
| `exit(1)` — transient | restarts, unbounded | restarts, **max 10** |
| `exit(0)` — terminal | restarts anyway | **stays down** |

That gives the app a way to signal "do not restart me": credential-terminal states (401/403/419, plus 500/411 from §2) should `exit(0)` and stay down until a QR is scanned, rather than retrying forever against creds that can never work.

Note: Docker's restart counter resets once a container has run successfully for a period, so a container that has been healthy for days is not penalised by restarts from last week. Verify this behaviour against your Docker version before relying on it for long-lived recovery.

### Fix 2 — put the delay inside the app

There is no Compose equivalent of `--restart-delay`. Docker's own backoff caps at ~1 minute, which is not enough distance for the 440 case in §2. Make the delay the app's responsibility, which is portable across any restart policy:

```ts
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const fatal = async (err: unknown, msg: string, opts: { retryable: boolean; delayMs?: number }) => {
    logger.fatal({ err }, msg)
    if (opts.delayMs) await sleep(opts.delayMs)   // real distance before Docker restarts us
    process.exit(opts.retryable ? 1 : 0)          // 0 = stay down, needs a human
}
```

Suggested mapping:

- Credential-terminal (401/403/419/500/411) → `fatal(err, msg, { retryable: false })` → `exit(0)`, container stays down.
- `connectionReplaced` (440, §2) → `fatal(err, msg, { retryable: true, delayMs: 300_000 })` → 5-minute sleep, then `exit(1)`; comes back, but slowly enough not to fight the other session.
- Everything else unexpected → `fatal(err, msg, { retryable: true, delayMs: 30_000 })`.

### Fix 3 — explicit `.catch()` on the two call sites

```ts
setTimeout(() => {
    sock.ev.removeAllListeners('connection.update')
    sock.ev.removeAllListeners('messages.upsert')
    sock.ev.removeAllListeners('creds.update')
    connectToWhatsApp(plan.retry).catch(e => fatal(e, 'reconnect chain died', { retryable: true, delayMs: 30_000 }))
}, plan.wait)

// module scope
connectToWhatsApp().catch(e => fatal(e, 'initial connect failed', { retryable: true, delayMs: 30_000 }))
```

The global handlers already prevent silent death here, so this is an observability and control improvement rather than a crash fix: it names the failure precisely in the log instead of surfacing as a generic unhandled rejection, and it routes through the delay/exit-code policy above rather than the blunt global path.

### Fix 4 — watchdog for "connected but wedged"

This case is **genuinely uncovered** by the existing global handlers, because nothing rejects and nothing throws — the process is alive, the socket is not usable, and no signal is ever emitted:

```ts
let lastOpenAt = Date.now()
// inside the connection === 'open' branch: lastOpenAt = Date.now()

setInterval(() => {
    if (Date.now() - lastOpenAt > 15 * 60_000) {
        fatal(null, 'no open connection in 15m', { retryable: true, delayMs: 30_000 })
    }
}, 60_000).unref()
```

A Docker `healthcheck` is *not* a substitute — outside Swarm, a failing healthcheck marks the container unhealthy but does not restart it.

---

## 2. CRITICAL — `connectionReplaced` (440) is an unwinnable war the backoff cannot damp

### Evidence

```ts
// reconnect.ts
const UNAUTHORIZED = [401, 403, 419]
```

440 is not in this set, so it falls through to the backoff path and reconnects.

### Problem

440 fires when another session takes over the same linked device. Reconnecting replaces *them*, which makes *them* reconnect and replace *you*. Neither side ever wins.

The `STABLE_MS` logic makes this specifically worse. In a 440 ping-pong, each session often holds **longer than 60s** before being replaced, so:

```ts
const next = sessionMs >= STABLE_MS ? 0 : retry + 1   // resets to 0 every cycle
```

`retry` resets to 0 on every cycle, the backoff never grows, and the ping-pong continues at 2s intervals indefinitely. This is the same class of bug `STABLE_MS` was written to fix, arriving from the opposite direction.

### Fix

440 needs its own branch — not backoff, but a delayed exit, so the in-app sleep from §1 Fix 2 puts real distance between attempts instead of two processes racing:

```ts
// reconnect.ts
if (statusCode === 440) {
    return { reconnect: false, wait: 0, retry, reason: 'replaced' }
}
```

At the call site in `socket.ts`, distinguish the three terminal shapes — currently they all take one `return` path with a credentials-specific log message:

- **replaced (440)** → `fatal(..., { retryable: true, delayMs: 300_000 })`
- **credentials dead (401/403/419)** → `fatal(..., { retryable: false })`
- **session broken (500/411)** → `fatal(..., { retryable: false })`

### Also add to the terminal set

These likewise cannot be fixed by retrying, and currently retry at 60s intervals forever (~1,440 attempts/day, never succeeding):

- **500 — `badSession`**
- **411 — `multideviceMismatch`**

Both require the session to be wiped and a fresh QR scan, so both should `exit(0)` and stay down.

---

## 3. IMPORTANT — `fetchLatestWaWebVersion` on every connect contradicts the docs

### Evidence

```ts
// socket.ts — runs on every single connect, including every reconnect
const { version, isLatest } = await fetchLatestWaWebVersion({})
if (!isLatest) logger.warn({ version }, 'could not fetch live WA version, using the version pinned in Baileys')
```

### What the docs say

The configuration page states it is **not recommended** to set the latest version on every connect (e.g. via `fetchLatestWaWebVersion`), as you may face incompatibility. If a custom version is set, protobufs should be up to date and you should stay a few versions behind.

### Assessment

The comment in the code gives a real justification — Baileys pins a WA web version at publish time, and once WA retires that revision it answers 405 at the registration handshake with no QR ever emitted. That is a genuine problem people hit. But three things make the current form risky:

1. **Unguarded network call inside the reconnect path.** It is `await`ed before `makeWASocket` with no timeout. If `web.whatsapp.com` is slow or unreachable — exactly what is likely during a connectivity-caused disconnect — every reconnect attempt stalls on it.
2. **The "it never throws" claim is a property of a dependency, not of this code.** If it does throw, it routes into the global handler and triggers the container-restart path of §1.
3. **`isLatest === false` does not mean "the fetch failed."** It can also mean the fetch succeeded and returned a non-latest version. The current log line reports the wrong cause.

### Fix

- Wrap in `try/catch` with an explicit timeout; fall back to the Baileys-pinned default on any failure.
- Only fetch on a **fresh start** or **after a 405** — not on every reconnect.
- Correct the log message to distinguish fetch failure from a non-latest result.

---

## 4. IMPORTANT — `useMultiFileAuthState` is still in production

### Evidence

```ts
// socket.ts
const { state, saveCreds } = await useMultiFileAuthState('./auth_session')
```

### What the docs say

Verbatim from the connecting page, in capitals: do not ever use `useMultiFileAuthState` in production. It consumes a lot of IO. Its implementation should be used only as a guide for writing a SQL/no-SQL/Redis auth state. The intro page repeats this.

### Why it matters more here than usual

The host is a **GCP e2-micro with a 10GB pd-standard disk** — the HDD-backed tier where IOPS scale with volume size, making this close to the slowest volume that can be provisioned, on a machine with 1GB of RAM. Auth keys rewrite on **every message** (Signal session updates), not only on reconnect. Any restart loop from §1 or §2 multiplies this IO.

Additional Docker-specific concern: `./auth_session` must be on a **named volume or bind mount**, not inside the container's writable layer. If it is not, every container restart discards the session and forces a fresh QR scan — which would also mean the `paired: false` branch in `reconnect.ts` is being hit far more often than intended. Verify this in `docker-compose.yml` before anything else in this section.

### Fix

Implement a Supabase-backed auth state, modeled on the library's `use-multi-file-auth-state.ts` implementation. Postgres is already a dependency. This is the single highest-value structural change remaining, and it also removes the volume-persistence concern above.

---

## 5. IMPORTANT — LID coverage is incomplete

Confirmed applicable: the installed version is `@whiskeysockets/baileys@7.0.0-rc13`, so the v7 LID migration is live, not hypothetical.

### Evidence

```ts
// socket.ts
const meJids = [sock.user!.id, sock.user!.lid].filter(Boolean).map(j => jidNormalizedUser(j!))
```

### Problem

Per the v7 migration notes, the `Contact` type no longer has separate `jid`/`lid` fields. It has an `id` (the form WhatsApp prefers) plus **either** `phoneNumber` **or** `lid`, depending on which form `id` is.

So when `id` is already a LID, the alternate lives in `phoneNumber` — which this code never reads. In that case `meJids` silently fails to match and **the bot goes quiet with no error**.

### Fix

```ts
const meJids = [sock.user!.id, sock.user!.lid, sock.user!.phoneNumber]
    .filter(Boolean)
    .map(j => jidNormalizedUser(j!))
```

Additionally, check `m.key.remoteJidAlt` alongside `m.key.remoteJid` when matching. v7 added `remoteJidAlt` specifically as the alternate JID for DMs; matching either form makes the self-chat filter robust regardless of which way the session migrates.

Also confirm the auth state supports the `lid-mapping`, `device-list`, and `tctoken` keys the migration guide calls out. The bundled `useMultiFileAuthState` handles these; a custom Supabase auth state (§4) must implement them explicitly or pairing will break.

---

## 6. Doc-compliance gaps

### `getMessage` is missing

The configuration page lists `auth`, `logger`, and `getMessage` as the **only strictly required** properties of the socket config. It is used for resending missing messages and decrypting poll votes.

Polls are irrelevant to this app; message resend is not. Implement it as a lookup against `meals.whatsapp_message_id`, or at minimum pass an explicit stub so the contract is intentional rather than accidental.

### `shouldSyncHistoryMessage: () => false`

The `type !== 'notify'` filter correctly *ignores* replayed history, but the sync still downloads and processes it first. On 1GB of RAM this is pure waste. Disable it at the source, per the history-sync page.

### `markOnlineOnConnect: false`

Default is `true`, which marks the client online and suppresses push notifications to the phone. Since the bot's confirmation message lands in the same self-chat being read, notifications for those confirmations may not be arriving.

---

## 7. Smaller items

### `sock.sendMessage` inside the `catch` block is unprotected

```ts
} catch (error) {
    log.error({ err: error }, 'Failed to estimate meal')
    await sock.sendMessage(m.key.remoteJid!, { text: `Unexpected Error: ${(error as Error).message}` })
    continue
}
```

If the socket is dead — plausible, since something already failed — this `await` throws *out of the catch block*, escapes the async `messages.upsert` handler, and becomes an unhandled rejection. With the global handler in place, that means the whole process exits and the container restarts over one failed meal log. Wrap the whole per-message body in its own try/catch, or `.catch()` this send specifically.

### Error text is sent straight to WhatsApp

Same line: `Unexpected Error: ${error.message}`. An OpenRouter or Supabase error message can carry request details, IDs, or partial config into the chat log. Log the full error; send a generic user-facing line.

### Listener removal happens too late

```ts
setTimeout(() => {
    sock.ev.removeAllListeners('connection.update')   // ← inside the wait
    ...
}, plan.wait)
```

The dead socket keeps its handlers attached for up to 60s. Move the three `removeAllListeners` calls to fire **immediately** on `close`, before scheduling the retry. Consider also calling `sock.end(undefined)` defensively — the connecting docs note that after `restartRequired` the old socket "is now useless."

### No timeout on `getNutritionEstimate`

A hung OpenRouter request blocks that message indefinitely — no confirmation, no error, no log line. Add `AbortSignal.timeout(30_000)` (or the client's equivalent).

### Logs are written to the container's stdout

The incident notes describe logging "straight to the VM's disk." Under Docker with the default `json-file` driver and no rotation, container logs grow unbounded on a **10GB disk**. Set explicit limits in `docker-compose.yml`:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

---

## Suggested order of work

1. **§1** — Docker restart bounding (`on-failure:10`), in-app delay + exit-code semantics, explicit `.catch()`, watchdog. *This is the piece that prevents the storm reforming at the container layer.*
2. **§2** — 440 / 500 / 411 terminal handling, wired to the exit-code policy from §1.
3. **§4 (verification only)** — confirm `./auth_session` is on a persistent volume, not the container's writable layer.
4. **§5** — LID `phoneNumber` fallback + `remoteJidAlt`.
5. **§3** — guard `fetchLatestWaWebVersion` with timeout + fallback, stop calling it on every reconnect.
6. **§6** — `getMessage`, `shouldSyncHistoryMessage`, `markOnlineOnConnect`.
7. **§7** — remaining small items, including Docker log rotation.
8. **§4 (implementation)** — Supabase-backed auth state. Largest change, deserves its own PR, and must carry the `lid-mapping` / `device-list` / `tctoken` keys from §5.
