// function: to identify if message is valid and extract the relevant content

const PREFIX = '/calories'

export default function MessageHandler(message: string): string | undefined {
    const trimmed = message.trim()

    // \b so '/caloriesfoo' doesn't match, only '/calories' followed by space or end
    if (!/^\/calories\b/i.test(trimmed)) return

    return trimmed.slice(PREFIX.length).trim() || undefined
}
