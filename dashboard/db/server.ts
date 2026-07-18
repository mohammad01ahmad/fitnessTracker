import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Session cookie persists 30 days regardless of the JWT's own (short) expiry;
// proxy.ts refreshes the underlying token on every request.
const THIRTY_DAYS = 60 * 60 * 24 * 30;

// Cookie-aware Supabase client for Server Components and Server Actions.
export const createClient = async () => {
    const cookieStore = await cookies();

    return createServerClient(supabaseUrl!, supabaseKey!, {
        cookieOptions: { maxAge: THIRTY_DAYS },
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
                } catch {
                    // Called from a Server Component render, where cookies can't be
                    // written — fine as long as proxy.ts is refreshing sessions.
                }
            },
        },
    });
};
