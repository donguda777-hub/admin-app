import { useState } from "react";
import { verifyAdminLoginPassword } from "../auth/verifyAdminLoginPassword";

const LOGIN_FAIL_MSG =
  "\uC544\uC774\uB514 \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.";

type LoginScreenProps = {
  onLoginSuccess: (loggedInUserId: string) => void;
};

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const tid = id.trim();
    const tpw = password.trim();
    if (verifyAdminLoginPassword(tid, tpw)) {
      onLoginSuccess(tid);
      return;
    }
    setError(LOGIN_FAIL_MSG);
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(255,214,0,0.12),transparent_55%)]" />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-6xl flex-col items-center">
          <div className="flex w-full justify-center px-1">
            <img
              src="/ln-admin-logo.png"
              alt="L&N"
              width={1024}
              height={576}
              className="mx-auto h-auto w-full max-w-[min(95vw,56rem)] min-w-[280px] object-contain"
            />
          </div>

          <form
            className="mt-8 w-full max-w-md space-y-5 md:mt-9"
            onSubmit={handleSubmit}
            autoComplete="on"
          >
            <div>
              <label
                htmlFor="admin-id"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-yellow-200/90"
              >
                ID
              </label>
              <input
                id="admin-id"
                name="username"
                type="text"
                autoComplete="username"
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="h-11 w-full rounded-lg border border-yellow-400/50 bg-zinc-950/90 px-3 text-sm text-yellow-50 shadow-neon-gold outline-none ring-0 transition placeholder:text-yellow-200/35 focus:border-yellow-300 focus:shadow-neon-gold-lg focus:ring-2 focus:ring-yellow-400/30"
                placeholder=""
              />
            </div>
            <div>
              <label
                htmlFor="admin-password"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-yellow-200/90"
              >
                PASSWORD
              </label>
              <input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-yellow-400/50 bg-zinc-950/90 px-3 text-sm text-yellow-50 shadow-neon-gold outline-none transition focus:border-yellow-300 focus:shadow-neon-gold-lg focus:ring-2 focus:ring-yellow-400/30"
              />
            </div>

            {error ? (
              <p className="text-center text-sm text-rose-300/95" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="mt-2 h-12 w-full rounded-lg border border-yellow-400/70 bg-gradient-to-b from-yellow-400/95 to-amber-600/95 text-sm font-bold uppercase tracking-[0.25em] text-zinc-950 shadow-neon-gold-lg transition hover:from-yellow-300 hover:to-amber-500 active:brightness-95"
            >
              LOGIN
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
