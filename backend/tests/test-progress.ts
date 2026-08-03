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

// formatProgress: under, over, and exactly-at target.
assert.match(formatProgress({ calories: 1400, protein_g: 102 }), /Calories 1400\/3000 \(1600 left\)/)
assert.match(formatProgress({ calories: 1400, protein_g: 102 }), /Protein  102\/120g \(18g left\)/)
assert.match(formatProgress({ calories: 3200, protein_g: 120 }), /Calories 3200\/3000 \(200 over\)/)
assert.match(formatProgress({ calories: 3000, protein_g: 120 }), /Calories 3000\/3000 \(0 left\)/)

console.log('ok — progress helpers')
