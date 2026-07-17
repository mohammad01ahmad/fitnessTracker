import type { MealRow } from "../utils/constants.ts"
import { supabase, USER_ID } from "./client.ts"

// user_id is static for this single-user tool, so it's injected here rather than
// threaded through every caller.
// Returns null if this message was already logged — the unique index on
// whatsapp_message_id is the idempotency check (PRD §8), not a pre-read.
export async function populateTable(meal: MealRow) {
    const { data, error } = await supabase
        .from("meals")
        .insert({ ...meal, user_id: USER_ID })
        .select()
        .single()

    if (error?.code === '23505') return null
    if (error) throw error
    return data
}
