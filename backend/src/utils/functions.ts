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

const BAR_CELLS = 10

/** `[██████░░░░]`-style fill bar, `BAR_CELLS` wide, rounded to the nearest cell. */
function bar(value: number, target: number): string {
    const filled = Math.round(Math.min(Math.max(value / target, 0), 1) * BAR_CELLS)
    return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
}

function progressLine(label: string, value: number, target: number, unit: string) {
    return `${label} [${bar(value, target)}] ${Math.round(value)}/${target}${unit}`
}

const DIVIDER_CHAR = '-'

/**
 * The divider + progress block appended to the WhatsApp confirmation.
 * `headerLines` are the message lines above the divider (meal + confidence) —
 * passed in so the divider can be sized to the widest line in the whole
 * message rather than a guessed fixed width.
 *
 * The bar lines are wrapped in WhatsApp's ``` monospace formatting so the
 * block-character bar renders at a fixed width on every device — WhatsApp's
 * default proportional font gives block characters inconsistent widths,
 * which is what risks the bar overlapping onto the next line on narrow
 * (mobile) screens even when it looks fine on WhatsApp Web.
 */
export function formatProgress(totals: { calories: number; protein_g: number }, headerLines: string[]): string {
    const lines = [
        progressLine('Calories', totals.calories, DAILY_TARGETS.calories, ''),
        progressLine('Protein ', totals.protein_g, DAILY_TARGETS.protein_g, 'g')
    ]
    const width = Math.max(...headerLines.map((l) => l.length), ...lines.map((l) => l.length))
    return [DIVIDER_CHAR.repeat(width), '```', ...lines, '```'].join('\n')
}
