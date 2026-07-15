
import makeWASocket, { DisconnectReason, jidNormalizedUser, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'

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

            // Only /calories commands. This is also what breaks the reply-to-self loop:
            // our own replies don't start with /calories, so they're skipped.
            if (!text.trim().toLowerCase().startsWith('/calories')) continue
            const meal = text.trim().slice('/calories'.length).trim()
            console.log('meal to log:', meal)

            // ponytail: echo placeholder until Claude + Supabase are wired (PRD §14)
            await sock.sendMessage(m.key.remoteJid!, { text: `(demo) got: ${meal}` })
        }
    })

    // to storage creds (session info) when it updates
    sock.ev.on('creds.update', saveCreds)
}
// run in main file
connectToWhatsApp()