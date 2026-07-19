
import makeWASocket, { DisconnectReason, jidNormalizedUser, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import MessageHandler from './messageHandler.ts'
import { getNutritionEstimate } from '../claude/openrouter_client.ts'
import { populateTable } from '../db/meals.ts'
import { logger } from '../utils/logger.js'

async function connectToWhatsApp() {

    // configuration and setup
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session') // loads previous states from auth_session
    const sock = makeWASocket({
        auth: state,
        logger // also silences/controls Baileys' own internal pino logs via LOG_LEVEL
    })

    // listening to events: when connection state changes
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        // first time: show qr code to connect whatsapp
        if (qr) qrcode.generate(qr, { small: true })

        // if disconnected
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            logger.warn({ err: lastDisconnect?.error, reconnecting: shouldReconnect }, 'WhatsApp connection closed')
            // reconnect if not logged out
            if (shouldReconnect) {
                connectToWhatsApp()
            }

            //  if connected successfully
        } else if (connection === 'open') {
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
            // self-chat only — any other chat could otherwise log meals and spend the API key
            if (!m.key.fromMe || !meJids.includes(jidNormalizedUser(m.key.remoteJid!))) continue

            const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? ''

            // extract meal from message
            const meal = MessageHandler(text.trim())
            if (!meal) continue

            // send to LLM to extract meal nutrition information
            try {
                const n = await getNutritionEstimate(meal)

                // insert before replying — a confirmation must mean the row landed (PRD §8)
                const row = await populateTable({ ...n, whatsapp_message_id: m.key.id!, raw_message_text: meal })
                if (!row) continue // already logged; don't confirm twice

                await sock.sendMessage(m.key.remoteJid!, {
                    text: `${n.meal_time}: ${n.calories} kcal | P ${n.protein_g}g Confidence: ${n.confidence}`
                })

            } catch (error) {
                logger.error({ err: error }, 'Failed to estimate meal')
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