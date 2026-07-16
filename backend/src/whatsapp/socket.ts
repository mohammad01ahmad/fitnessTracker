
import makeWASocket, { DisconnectReason, jidNormalizedUser, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import MessageHandler from './messageHandler.ts'
import { getNutritionEstimate } from '../claude/openrouter_client.ts'

async function connectToWhatsApp() {

    // configuration and setup
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session') // loads previous states from auth_session
    const sock = makeWASocket({
        auth: state
    })

    // listening to events: when connection state changes
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        // first time: show qr code to connect whatsapp
        if (qr) qrcode.generate(qr, { small: true })

        // if disconnected
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
            // reconnect if not logged out
            if (shouldReconnect) {
                connectToWhatsApp()
            }

            //  if connected successfully 
        } else if (connection === 'open') {
            console.log('opened connection')
            sock.sendMessage(jidNormalizedUser(sock.user!.id), { text: 'Connection successful ✅' })
        }
    })

    // listening to events: when receiving a message
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return // ignore history replayed on (re)connect
        for (const m of messages) {
            const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? ''

            // extract meal from message
            const meal = MessageHandler(text.trim())
            if (!meal) continue

            // send to LLM to extract meal nutrition information
            try {
                const n = await getNutritionEstimate(meal)
                await sock.sendMessage(m.key.remoteJid!, {
                    text: `${n.meal_type}: ${n.calories} kcal | P ${n.protein_g}g C ${n.carbs_g}g F ${n.fat_g}g (${n.confidence})`
                })
            } catch (error) {
                console.error('failed to estimate meal: ', error)
                await sock.sendMessage(m.key.remoteJid!, { text: `Unexpected Error in LLM call: ${(error as Error).message}` })
                continue
            }
        }
    })

    // to storage creds (session info) when it updates
    sock.ev.on('creds.update', saveCreds)
}
// run in main file
connectToWhatsApp()