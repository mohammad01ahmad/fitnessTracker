// Checks the DB path without WhatsApp or the LLM: insert lands, duplicate is rejected.
// Run: node --env-file=.env tests/test-db.ts
import { populateTable } from '../src/db/meals.ts'
import { supabase } from '../src/db/client.ts'

const meal = {
    whatsapp_message_id: 'TEST_' + Date.now(),
    raw_message_text: '200g rice 50g beef lunch',
    food_items: [{ name: 'rice', quantity: 200, unit: 'g' }, { name: 'beef', quantity: 50, unit: 'g' }],
    calories: 480,
    protein_g: 22,
    confidence: 'medium' as const,
    meal_time: 'Lunch' as const,
}

const first = await populateTable(meal)
if (!first) throw new Error('FAIL: first insert returned null, expected a row')
console.log('ok: row inserted')

// populateTable injects user_id; nothing else would catch it going missing
if (first.user_id !== process.env.SUPABASE_USER_ID) throw new Error(`FAIL: user_id was '${first.user_id}', expected '${process.env.SUPABASE_USER_ID}'`)
console.log('ok: user_id set')

const second = await populateTable(meal)
if (second !== null) throw new Error('FAIL: duplicate was accepted — the unique constraint on whatsapp_message_id is missing')
console.log('ok: duplicate rejected')

await supabase.from('meals').delete().eq('whatsapp_message_id', meal.whatsapp_message_id)
console.log('ok: cleaned up\n\nDB path works.')
