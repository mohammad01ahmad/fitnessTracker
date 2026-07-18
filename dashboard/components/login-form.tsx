"use client";

import { useActionState } from "react";
import { signIn } from "../utility/authHooks";

const INPUT =
    "w-full rounded-xl border border-[#EFEEF4] bg-[#F9F8FB] px-4 py-2.5 text-sm text-[#16151A] outline-none focus:border-[#FF5A4E]";

export function LoginForm() {
    const [state, action, pending] = useActionState(signIn, null);

    return (
        <form action={action} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-medium text-[#8A8894]">
                    Email
                </label>
                <input id="email" name="email" type="email" autoComplete="email" required className={INPUT} />
            </div>
            <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium text-[#8A8894]">
                    Password
                </label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className={INPUT}
                />
            </div>
            {state?.error && <p className="text-sm text-[#B33328]">{state.error}</p>}
            <button
                type="submit"
                disabled={pending}
                className="mt-1 rounded-xl bg-[#FF5A4E] py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
                {pending ? "Logging in…" : "Log in"}
            </button>
        </form>
    );
}
