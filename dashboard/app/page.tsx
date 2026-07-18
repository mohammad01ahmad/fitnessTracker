import { LoginForm } from "../components/login-form";

export default function Home() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-[#E7E5EE] p-4">
            <div className="flex w-full max-w-sm flex-col gap-6 rounded-3xl bg-white p-8 shadow-sm shadow-black/5">
                <div className="flex flex-col gap-1">
                    <span className="text-2xl">🔥</span>
                    <h1 className="text-lg font-bold text-[#16151A]">Calorie tracker</h1>
                    <p className="text-sm text-[#8A8894]">Log in to see today&apos;s numbers.</p>
                </div>
                <LoginForm />
            </div>
        </div>
    );
}
