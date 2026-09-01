"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { friendlyAuthError } from "@/lib/authErrors";

export default function LandingPage() {
  const { user, loading, signIn, signUp, signInWithGoogle, linkPassword } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shown once, right after a brand-new Google sign-up, so the account isn't
  // permanently locked to the popup (see AuthContext's linkPassword).
  const [offerSetPassword, setOfferSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (!loading && user && !offerSetPassword) router.replace("/dashboard");
  }, [loading, user, offerSetPassword, router]);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
    } catch (err) {
      setError(friendlyAuthError(err));
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setSubmitting(true);
    setError(null);
    try {
      const { isNewUser } = await signInWithGoogle();
      if (isNewUser) setOfferSetPassword(true);
    } catch (err) {
      setError(friendlyAuthError(err));
      setSubmitting(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await linkPassword(newPassword);
      setOfferSetPassword(false);
    } catch (err) {
      setError(friendlyAuthError(err));
      setSubmitting(false);
    }
  }

  if (offerSetPassword) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Set a password?</h1>
          <p className="mt-2 max-w-sm text-slate-600 dark:text-slate-400">
            You&apos;re signed in with Google. Add a password too, so you can sign in even if Google isn&apos;t
            available (e.g. popups blocked).
          </p>
        </div>
        <form onSubmit={handleSetPassword} className="flex w-full max-w-xs flex-col gap-3">
          <input
            type="password"
            required
            minLength={6}
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {submitting ? "Saving…" : "Set password"}
          </button>
        </form>
        <button
          onClick={() => setOfferSetPassword(false)}
          className="text-xs text-slate-500 hover:underline dark:text-slate-400"
        >
          Skip for now
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">SplitBill</h1>
        <p className="mt-2 max-w-sm text-slate-600 dark:text-slate-400">
          Scan a receipt, let everyone claim their items, and share a QR code to get paid back.
        </p>
      </div>

      <form onSubmit={handleEmailSubmit} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={loading || submitting}
          className="rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {submitting ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
        className="-mt-3 text-xs text-slate-500 hover:underline dark:text-slate-400"
      >
        {mode === "signin" ? "Don't have an account? Create one" : "Already have an account? Sign in"}
      </button>

      <div className="flex w-full max-w-xs items-center gap-3 text-xs text-slate-400 dark:text-slate-600">
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        or
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

      <button
        onClick={handleGoogle}
        disabled={loading || submitting}
        className="w-full max-w-xs rounded-full border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
      >
        Continue with Google
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-xs text-slate-400 dark:text-slate-600">Guests joining a bill don&apos;t need an account.</p>
    </main>
  );
}
