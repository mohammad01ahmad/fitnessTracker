
import makeWASocket, { DisconnectReason, jidNormalizedUser, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import MessageHandler from './messageHandler.ts'
import { getNutritionEstimate } from '../claude/openrouter_client.ts'
import { populateTable } from '../db/meals.ts'
import { logger } from '../utils/logger.js'

async function connectToWhatsApp(retry = 0) {

    // configuration and setup
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session') // loads previous states from auth_session
    const sock = makeWASocket({
        auth: state,
        logger // also silences/controls Baileys' own internal pino logs via LOG_LEVEL
    })

    // 'close' can fire more than once on a dead socket; without this each one
    // would start its own reconnect chain, so the loop doubles every round.
    let closed = false

    // listening to events: when connection state changes
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        // first time: show qr code to connect whatsapp
        if (qr) qrcode.generate(qr, { small: true })

        // if disconnected
        if (connection === 'close') {
            if (closed) return
            closed = true
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            // Backoff matters: WA answers a reconnect storm with 405 ("Connection
            // Failure", location odn), which isn't in DisconnectReason, so the old
            // immediate retry treated it as recoverable and hammered harder.
            // ponytail: capped exponential, no jitter — one client, no herd to thunder
            const wait = Math.min(2 ** retry * 1000, 60_000)
            logger.warn({ err: lastDisconnect?.error, reconnecting: shouldReconnect, retryInMs: wait }, 'WhatsApp connection closed')
            // reconnect if not logged out
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(retry + 1), wait)
            }

            //  if connected successfully
        } else if (connection === 'open') {
            retry = 0 // a good connection clears the backoff for this socket's next close
            logger.info('WhatsApp connection opened')
            sock.sendMessage(jidNormalizedUser(sock.user!.id), { text: 'Connection successful ✅' })
                .catch((error) => logger.error({ err: error }, 'Failed to send connection confirmation'))
        }
    })

    // listening to events: when receiving a message
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return // ignore history replayed on (re)connect
        // Baileys 7 routes self-chat by LID, not the phone-number JID — accept either
        const meJids = [sock.user!.id, sock.user!.lid].filter(Boolean).map(j => jidNormalizedUser(j!))

        for (const m of messages) {
            // One child logger per message: every line below carries the same msgId,
            // so `docker compose logs | grep <id>` is the whole story of one meal.
            const log = logger.child({ msgId: m.key.id })

            // self-chat only — any other chat could otherwise log meals and spend the API key
            if (!m.key.fromMe || !meJids.includes(jidNormalizedUser(m.key.remoteJid!))) {
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
                await sock.sendMessage(m.key.remoteJid!, { text: `Unexpected Error: ${(error as Error).message}` })
                continue
            }
        }
    })

    // to storage creds (session info) when it updates
    sock.ev.on('creds.update', saveCreds)
}
// run in main file
connectToWhatsApp()