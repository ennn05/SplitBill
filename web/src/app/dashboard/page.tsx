"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createBill, getBills } from "@/lib/api";
import type { Bill } from "@/lib/types";

const STATUS_LABEL: Record<Bill["status"], string> = {
  draft: "Draft",
  open: "Open",
  locked: "Locked",
  settled: "Settled",
};

export default function DashboardPage() {
  const { user, loading, getIdToken, signOut } = useAuth();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bills, setBills] = useState<Bill[] | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  const [billsError, setBillsError] = useState<string | null>(null);

  const loadBills = useCallback(async () => {
    setBillsError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      setBills(await getBills(idToken));
    } catch (err) {
      // An unhandled rejection here would silently leave "Your bills" empty
      // forever with no indication anything went wrong - surface it instead.
      setBillsError(err instanceof Error ? err.message : "Failed to load your bills");
    }
  }, [getIdToken]);

  useEffect(() => {
    // Genuine data fetch tied to the signed-in user, not synchronously-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) loadBills();
  }, [user, loadBills]);

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
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Settings
          </Link>
          <button onClick={() => signOut()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Sign out
          </button>
        </div>
      </div>

      <button
        onClick={handleCreateBill}
        disabled={creating}
        className="rounded-lg bg-slate-900 px-5 py-4 text-left text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        {creating ? "Creating bill…" : "+ New bill — upload a receipt"}
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {billsError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {billsError}{" "}
          <button onClick={loadBills} className="underline">
            Retry
          </button>
        </p>
      )}

      {bills && bills.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Your bills</h2>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {bills.map((bill) => (
              <li key={bill.id}>
                <Link
                  href={`/bills/${bill.id}`}
                  className="flex items-center justify-between p-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span>{bill.title || "Untitled bill"}</span>
                  <span className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                    RM {Number(bill.total).toFixed(2)}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                      {STATUS_LABEL[bill.status]}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
