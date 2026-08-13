// Pure unit test for the daily-progress helpers in utils/constants.ts — no
// network, no DB. Run: node tests/test-progress.ts
import assert from 'node:assert/strict'
import { dubaiDayStart, formatProgress } from '../src/utils/functions.ts'

// 00:30 and 23:30 Dubai on the same local day must map to the same UTC boundary.
const morning = Date.parse('2026-08-03T00:30:00+04:00')
const night = Date.parse('2026-08-03T23:30:00+04:00')
assert.equal(dubaiDayStart(morning), dubaiDayStart(night))
assert.equal(dubaiDayStart(morning), '2026-08-02T20:00:00.000Z')

// 03:00 UTC is 07:00 Dubai — same Dubai calendar day as 00:30 UTC (04:30 Dubai),
// so both must land on the same boundary. This is the case a naive UTC-day
// split gets wrong.
const utcEarly = Date.parse('2026-08-03T00:30:00Z')
const utcLater = Date.parse('2026-08-03T03:00:00Z')
assert.equal(dubaiDayStart(utcEarly), dubaiDayStart(utcLater))

// formatProgress: under, over, and exactly-at target — bar fill rounds to
// the nearest of 10 cells (1400/3000 = 46.7% -> 5 filled, 102/120 = 85% -> 9 filled).
assert.match(formatProgress({ calories: 1400, protein_g: 102 }, []), /Calories \[█████░░░░░\] 1400\/3000/)
assert.match(formatProgress({ calories: 1400, protein_g: 102 }, []), /Protein  \[█████████░\] 102\/120g/)
// Over target clamps the bar full rather than overflowing past 10 cells.
assert.match(formatProgress({ calories: 3200, protein_g: 120 }, []), /Calories \[██████████\] 3200\/3000/)
assert.match(formatProgress({ calories: 3000, protein_g: 120 }, []), /Calories \[██████████\] 3000\/3000/)

// Bar lines are wrapped in ``` monospace so the fill bar renders at a fixed
// width on every device (see formatProgress doc comment). The backticks are
// fused onto the first/last content line — no standalone ``` line, which is
// what causes WhatsApp to render a blank line before the fenced content.
const fenced = formatProgress({ calories: 1400, protein_g: 102 }, []).split('\n')
assert.equal(fenced.length, 3) // divider, opening-fenced line, closing-fenced line
assert.match(fenced[1], /^```Calories/)
assert.match(fenced[2], /120g```$/)

// Divider uses ━, sized to the widest line — a long header line forces a
// wider divider than the progress lines alone would need.
const longHeader = 'x'.repeat(50)
const [divider] = formatProgress({ calories: 1400, protein_g: 102 }, [longHeader]).split('\n')
assert.equal(divider, '━'.repeat(50))

// With no header (or a short one), the divider still covers the widest
// progress line rather than collapsing to zero width.
const [shortDivider] = formatProgress({ calories: 1400, protein_g: 102 }, []).split('\n')
assert.equal(shortDivider.length, 'Calories [█████░░░░░] 1400/3000'.length)

console.log('ok — progress helpers')
