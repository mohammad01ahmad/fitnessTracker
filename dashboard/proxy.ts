import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

// Runs on every matched request: refreshes the auth token (writing the
// renewed cookie to both the request and response) and gates /dashboard.
export async function proxy(request: NextRequest) {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(supabaseUrl!, supabaseKey!, {
        cookieOptions: { maxAge: THIRTY_DAYS },
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                response = NextResponse.next({ request });
                cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
            },
        },
    });

    // Never trust getSession() here — getClaims() verifies the JWT signature.
    const { data } = await supabase.auth.getClaims();
    const loggedIn = Boolean(data?.claims);
    const { pathname } = request.nextUrl;

    if (!loggedIn && pathname.startsWith("/dashboard")) {
        return NextResponse.redirect(new URL("/", request.url));
    }
    if (loggedIn && pathname === "/") {
        return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
