
import makeWASocket, { fetchLatestWaWebVersion, jidNormalizedUser, useMultiFileAuthState, type WAVersion } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import MessageHandler from './messageHandler.ts'
import { reconnectPlan } from './reconnect.ts'
import { fatal } from './fatal.ts'
import { getNutritionEstimate } from '../claude/openrouter_client.ts'
import { populateTable } from '../db/meals.ts'
import { logger } from '../utils/logger.js'

async function connectToWhatsApp(retry = 0, refetchVersion = true, isFirstConnect = true) {

    // configuration and setup
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session') // loads previous states from auth_session

    // Baileys pins a WA web version at publish time (Defaults/index.js). Once WA
    // retires that revision it answers 405 at the *registration* handshake — no QR
    // is ever emitted. This reads the live revision out of web.whatsapp.com/sw.js.
    // fetchLatestWaWebVersion never throws (it falls back to the pinned version
    // internally on any failure), but has no built-in timeout — cap it so a
    // slow/unreachable web.whatsapp.com can't stall a reconnect. Only refetch on a
    // fresh start or right after a 405; every other reconnect reuses whatever
    // version last worked, per the docs' "don't refetch on every connect" guidance.
    let version: WAVersion | undefined
    if (refetchVersion) {
        const result = await fetchLatestWaWebVersion({ signal: AbortSignal.timeout(5_000) })
        if (result.isLatest) {
            version = result.version
        } else {
            logger.warn({ err: result.error }, 'failed to fetch live WA web version, using the version pinned in Baileys')
        }
    }

    const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        logger, // also silences/controls Baileys' own internal pino logs via LOG_LEVEL
        // Resend requests and poll-vote decryption need a message store; this app
        // sends no polls and keeps none, so there's nothing to resupply.
        // ponytail: always undefined — add an in-memory cache of sent messages if resend requests start showing up in logs.
        getMessage: async () => undefined,
        // Deliberately NOT overriding shouldSyncHistoryMessage: disabling all sync
        // types blocks the history-sync path that populates LID mappings (Baileys
        // warns loudly about this — "DANGER... LEADING TO INSTABILIY AND SESSION
        // ERRORS" — and it's not idle caution; a 2026-07-31 incident confirmed it).
        // The library's own default already excludes the expensive FULL history
        // type, so the memory concern that motivated overriding this is already
        // handled without cutting off LID mapping sync.
        // Default true marks the client "online," which suppresses phone push
        // notifications — including for this bot's own confirmation replies.
        markOnlineOnConnect: false
    })

    // 'close' can fire more than once on a dead socket; without this each one
    // would start its own reconnect chain, so the loop doubles every round.
    let closed = false
    // 0 until 'open'; used to tell a healthy session's drop from an open→close flap.
    let openedAt = 0

    // No app-level "is it wedged" watchdog here on purpose: Baileys' own keepalive
    // (Socket/socket.js) pings every 30s and self-closes with
    // DisconnectReason.connectionLost (408) if the server goes quiet for 35s —
    // that 408 isn't in any of reconnect.ts's terminal sets, so it already flows
    // through the normal backoff path below. A from-scratch timer here previously
    // fired unconditionally ~15min after every successful open, healthy or not
    // (confirmed by a 2026-07-31 incident) — it was racing a faster, correct
    // mechanism that already existed, not covering a real gap.

    // listening to events: when connection state changes
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        // first time: show qr code to connect whatsapp
        if (qr) qrcode.generate(qr, { small: true })

        // if disconnected
        if (connection === 'close') {
            if (closed) return
            closed = true

            // Detach immediately, not after the backoff wait — a dead socket
            // otherwise keeps its handlers live for up to 60s.
            sock.ev.removeAllListeners('connection.update')
            sock.ev.removeAllListeners('messages.upsert')
            sock.ev.removeAllListeners('creds.update')
            sock.end(undefined) // per the docs: after a close, the old socket "is now useless"

            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
            // WA answers a reconnect storm with 405 ("Connection Failure"), which
            // isn't in DisconnectReason — so the policy keys off the raw status
            // code rather than trying to enumerate recoverable reasons.
            const plan = reconnectPlan({
                statusCode,
                retry,
                paired: Boolean(state.creds.me),
                sessionMs: openedAt ? Date.now() - openedAt : 0
            })
            logger.warn({ err: lastDisconnect?.error, reconnecting: plan.reconnect, retryInMs: plan.wait }, 'WhatsApp connection closed')

            if (!plan.reconnect) {
                if (plan.reason === 'replaced') {
                    // Another session took over this linked device. Reconnecting
                    // immediately would just replace them back, and they'd replace
                    // us again — put real distance between attempts, then try once.
                    fatal(lastDisconnect?.error, 'connection replaced by another session (440)', { retryable: true, delayMs: 300_000 })
                } else {
                    // creds dead (401/403/419) or session broken (500/411) — no
                    // amount of retrying fixes either; needs a fresh QR scan.
                    fatal(lastDisconnect?.error, `credentials rejected (${plan.reason}) — wipe auth_session and scan a new QR`, { retryable: false })
                }
                return
            }

            setTimeout(() => {
                connectToWhatsApp(plan.retry, statusCode === 405, false)
                    .catch(e => fatal(e, 'reconnect chain died', { retryable: true, delayMs: 30_000 }))
            }, plan.wait)

            //  if connected successfully
        } else if (connection === 'open') {
            openedAt = Date.now() // backoff resets only if this session lasts, see reconnect.ts
            logger.info('WhatsApp connection opened')
            // Only ping on the very first connect of this process — automatic
            // reconnects are routine (WA-side blips, brief network hiccups) and
            // don't need a WhatsApp message every time one resolves in a few seconds.
            if (isFirstConnect) {
                sock.sendMessage(jidNormalizedUser(sock.user!.id), { text: 'Connection successful ✅' })
                    .catch((error) => logger.error({ err: error }, 'Failed to send connection confirmation'))
            }
        }
    })

    // listening to events: when receiving a message
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return // ignore history replayed on (re)connect
        // Baileys 7 routes self-chat by LID, not the phone-number JID. When `id` is
        // already a LID form, the phone-number alternate lives in `phoneNumber`, not
        // `lid` — miss it and the filter below silently matches nothing.
        const meJids = [sock.user!.id, sock.user!.lid, sock.user!.phoneNumber].filter(Boolean).map(j => jidNormalizedUser(j!))

        for (const m of messages) {
            // One child logger per message: every line below carries the same msgId,
            // so `docker compose logs | grep <id>` is the whole story of one meal.
            const log = logger.child({ msgId: m.key.id })

            // self-chat only — any other chat could otherwise log meals and spend the
            // API key. remoteJidAlt is v7's alternate JID form for DMs (LID vs phone
            // number) — check both, since which form a message arrives in depends on
            // which side of the LID migration this session is on.
            const remoteJid = jidNormalizedUser(m.key.remoteJid!)
            const remoteJidAlt = m.key.remoteJidAlt ? jidNormalizedUser(m.key.remoteJidAlt) : undefined
            const isSelfChat = meJids.includes(remoteJid) || (remoteJidAlt !== undefined && meJids.includes(remoteJidAlt))
            if (!m.key.fromMe || !isSelfChat) {
                // debug, not info: this fires for every message in every chat
                log.debug({ from: m.key.remoteJid, fromMe: m.key.fromMe, meJids }, 'skipped: not self-chat')
                continue
            }

            const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? ''

            // extract meal from message
            const meal = MessageHandler(text.trim())
            if (!meal) {
                log.debug({ text }, 'skipped: no /calories prefix')
                continue
            }
            log.info({ meal }, 'meal command received')

            // send to LLM to extract meal nutrition information
            try {
                const startedAt = Date.now()
                const n = await getNutritionEstimate(meal)
                log.info({ ms: Date.now() - startedAt, calories: n.calories, confidence: n.confidence }, 'nutrition estimated')

                // insert before replying — a confirmation must mean the row landed (PRD §8)
                const row = await populateTable({ ...n, whatsapp_message_id: m.key.id!, raw_message_text: meal })
                if (!row) {
                    log.info('skipped: already logged') // duplicate; don't confirm twice
                    continue
                }
                log.info({ rowId: row.id }, 'meal row inserted')

                await sock.sendMessage(m.key.remoteJid!, {
                    text: `${n.meal_time}: ${n.calories} kcal | P ${n.protein_g}g Confidence: ${n.confidence}`
                })
                log.info('confirmation sent')

            } catch (error) {
                log.error({ err: error }, 'Failed to estimate meal')
                // .catch, not a bare await: if the socket is already dead — plausible,
                // since something just failed — this throw would otherwise escape the
                // catch block as an unhandled rejection and take the whole process
                // down over one bad meal log. Generic text only: provider/DB error
                // messages can carry request details into the chat log.
                await sock.sendMessage(m.key.remoteJid!, { text: 'Something went wrong logging that meal — check the logs.' })
                    .catch((sendError) => log.error({ err: sendError }, 'failed to send error notification'))
                continue
            }
        }
    })

    // to storage creds (session info) when it updates
    sock.ev.on('creds.update', saveCreds)
}
// run in main file
connectToWhatsApp().catch(e => fatal(e, 'initial connect failed', { retryable: true, delayMs: 30_000 }))
