import { createClient } from '@supabase/supabase-js'

// Service role key — backend writes have no browser session, so they bypass RLS (PRD §10).
// Never NEXT_PUBLIC_-prefixed: that prefix means "safe to ship to a browser", which this is not.
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const userId = process.env.SUPABASE_USER_ID

// fail at boot, not at the first insert
if (!supabaseUrl || !supabaseServiceRoleKey || !userId) {
    throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_USER_ID in backend/.env')
}

// meals.user_id is a uuid FK to auth.users — this is Ahmad's own auth user id
export const USER_ID = userId

export const supabase = createClient(
    supabaseUrl,
    supabaseServiceRoleKey
)
