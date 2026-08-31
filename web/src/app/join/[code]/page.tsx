"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJoinPreview, joinBill } from "@/lib/api";
import { storeGuestSession } from "@/lib/guestSession";

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [preview, setPreview] = useState<{ billId: string; title: string | null; status: string } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    getJoinPreview(code)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : "Invalid join link"));
  }, [code]);

  async function handleJoin() {
    if (!name.trim()) return;
    setJoining(true);
    setError(null);
    try {
      const { billId, participantId, guestToken } = await joinBill(code, name.trim());
      storeGuestSession(billId, { participantId, guestToken });
      router.push(`/bill-guest/${billId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join");
      setJoining(false);
    }
  }

  if (error && !preview) {
    return <p className="p-8 text-center text-red-600">{error}</p>;
  }
  if (!preview) {
    return <p className="p-8 text-center text-slate-500">Loading…</p>;
  }
  if (preview.status !== "open") {
    return <p className="p-8 text-center text-slate-600">This bill isn&apos;t accepting new people right now.</p>;
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">{preview.title || "Join this bill"}</h1>
      <p className="text-sm text-slate-500">Enter your name to see the items and claim what&apos;s yours.</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="rounded border border-slate-300 px-3 py-2 text-sm"
        onKeyDown={(e) => e.key === "Enter" && handleJoin()}
      />
      <button
        onClick={handleJoin}
        disabled={joining || !name.trim()}
        className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {joining ? "Joining…" : "Join"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
