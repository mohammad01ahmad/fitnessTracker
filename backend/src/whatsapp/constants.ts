// Tuning knobs for the WhatsApp socket lifecycle — reconnect policy (reconnect.ts)
// and connection watchdog (socket.ts). Kept together so the numbers that shape
// "when do we give up / retry / declare wedged" are all in one place.

/** 401/403/419 — Baileys' UNAUTHORIZED_CODES. Creds are dead; only a QR scan fixes it. */
export const UNAUTHORIZED = [401, 403, 419]

/** 500 badSession / 411 multideviceMismatch — session itself is broken, not just creds. Only a fresh QR fixes either. */
export const SESSION_BROKEN = [500, 411]

/**
 * 440 connectionReplaced — another session took over this linked device.
 * Reconnecting replaces *them*, which makes *them* reconnect and replace
 * *you* — an unwinnable ping-pong backoff can't damp (see reason: 'replaced').
 */
export const REPLACED = 440

/** A connection that held this long counts as healthy, so its drop starts a fresh backoff. */
export const STABLE_MS = 60_000

export const MAX_WAIT_MS = 60_000

// How long a socket can go without an 'open' before it's assumed wedged — alive
// but unusable, with nothing throwing for index.js's global handlers to catch.
export const WATCHDOG_IDLE_MS = 15 * 60_000
export const WATCHDOG_CHECK_MS = 60_000
