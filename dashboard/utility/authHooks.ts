"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/db/server";

export type SignInState = { error: string } | null;

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        return { error: "Wrong email or password." };
    }

    redirect("/dashboard");
}

export async function signOut() {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/");
}
