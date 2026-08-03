import type { MealRow } from "../utils/constants.ts"
import { dubaiDayStart } from "../utils/functions.ts"
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

// Sum of today's (Asia/Dubai) logged meals, for the WhatsApp progress line.
// ponytail: sums in JS rather than a `sum()` aggregate — a handful of rows/day
// for one user. Switch to a DB-side sum if a day's row count ever gets large.
export async function dayTotals() {
    const { data, error } = await supabase
        .from("meals")
        .select("calories, protein_g")
        .eq("user_id", USER_ID)
        .gte("created_at", dubaiDayStart())

    if (error) throw error
    return data.reduce(
        (totals, row) => ({
            calories: totals.calories + Number(row.calories ?? 0),
            protein_g: totals.protein_g + Number(row.protein_g ?? 0)
        }),
        { calories: 0, protein_g: 0 }
    )
}
