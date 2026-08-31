"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function LandingPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">SplitBill</h1>
        <p className="mt-2 max-w-sm text-slate-600">
          Scan a receipt, let everyone claim their items, and share a QR code to get paid back.
        </p>
      </div>
      <button
        onClick={() => signInWithGoogle()}
        disabled={loading}
        className="rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
      >
        Sign in with Google to start a bill
      </button>
      <p className="text-xs text-slate-400">Guests joining a bill don&apos;t need an account.</p>
    </main>
  );
}
