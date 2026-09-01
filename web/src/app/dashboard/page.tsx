"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createBill } from "@/lib/api";

export default function DashboardPage() {
  const { user, loading, getIdToken, signOut } = useAuth();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  async function handleCreateBill() {
    setCreating(true);
    setError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Not signed in");
      const bill = await createBill(idToken);
      router.push(`/bills/${bill.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bill");
      setCreating(false);
    }
  }

  if (loading || !user) return null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Hi, {user.displayName ?? "there"}</h1>
        <button onClick={() => signOut()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          Sign out
        </button>
      </div>

      <button
        onClick={handleCreateBill}
        disabled={creating}
        className="rounded-lg bg-slate-900 px-5 py-4 text-left text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        {creating ? "Creating bill…" : "+ New bill — upload a receipt"}
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}
