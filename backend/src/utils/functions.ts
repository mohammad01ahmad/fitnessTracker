import { DAILY_TARGETS } from './constants.ts'

// PRD §5: timezone handled as a fixed offset (Asia/Dubai, UTC+4), no DST — so
// "start of today" is plain arithmetic, no timezone library needed.
const DUBAI_OFFSET_MS = 4 * 60 * 60_000

/** ISO UTC instant of the most recent Asia/Dubai midnight, as of `now`. */
export function dubaiDayStart(now = Date.now()): string {
    const dubaiNow = now + DUBAI_OFFSET_MS
    const dubaiMidnight = Math.floor(dubaiNow / 86_400_000) * 86_400_000
    return new Date(dubaiMidnight - DUBAI_OFFSET_MS).toISOString()
}

function progressLine(label: string, value: number, target: number, unit: string) {
    const diff = target - Math.round(value)
    const note = diff >= 0 ? `${diff}${unit} left` : `${-diff}${unit} over`
    return `${label} ${Math.round(value)}/${target}${unit} (${note})`
}

const DIVIDER_CHAR = '-'

/**
 * The divider + progress block appended to the WhatsApp confirmation.
 * `headerLines` are the message lines above the divider (meal + confidence) —
 * passed in so the divider can be sized to the widest line in the whole
 * message rather than a guessed fixed width.
 */
export function formatProgress(totals: { calories: number; protein_g: number }, headerLines: string[]): string {
    const lines = [
        progressLine('Calories', totals.calories, DAILY_TARGETS.calories, ''),
        progressLine('Protein ', totals.protein_g, DAILY_TARGETS.protein_g, 'g')
    ]
    const width = Math.max(...headerLines.map((l) => l.length), ...lines.map((l) => l.length))
    return [DIVIDER_CHAR.repeat(width), ...lines].join('\n')
}
