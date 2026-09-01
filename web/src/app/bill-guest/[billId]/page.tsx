"use client";

import { use, useEffect, useState } from "react";
import { useBillSocket } from "@/lib/useBillSocket";
import { getGuestSession } from "@/lib/guestSession";
import { BillItemsList } from "@/components/BillItemsList";

export default function GuestBillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = use(params);
  const [guestToken, setGuestToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // sessionStorage only exists in the browser, so this can't be a lazy useState
    // initializer without mismatching the server-rendered HTML during hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGuestToken(getGuestSession(billId)?.guestToken ?? null);
  }, [billId]);

  const { state, error, claimItem, unclaimItem } = useBillSocket(guestToken ? billId : null, guestToken ?? null);

  if (guestToken === undefined) return null;
  if (guestToken === null) {
    return (
      <p className="p-8 text-center text-slate-600 dark:text-slate-400">
        Your session expired. Use the join link or code you were given to rejoin.
      </p>
    );
  }
  if (!state) return <p className="p-8 text-center text-slate-500 dark:text-slate-400">Connecting…</p>;

  const myTotal = state.totals.perParticipant.find((t) => t.participantId === state.yourParticipantId);
  const myPayment = state.payments.find((p) => p.participant_id === state.yourParticipantId);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{state.bill.title || "Bill"}</h1>

      <section className="rounded-lg bg-slate-900 p-4 text-center text-white">
        <p className="text-sm opacity-80">You owe</p>
        <p className="text-3xl font-semibold">RM {(myTotal?.total ?? 0).toFixed(2)}</p>
        {myPayment?.marked_paid_by_payer && <p className="mt-1 text-sm text-green-400">Marked as paid</p>}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Tap what&apos;s yours</h2>
        <BillItemsList
          items={state.items}
          claims={state.claims}
          participants={state.participants}
          myParticipantId={state.yourParticipantId}
          onClaim={claimItem}
          onUnclaim={unclaimItem}
        />
      </section>

      {state.bill.payment_qr_image_url && (
        <section className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">Scan to pay the payer</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.bill.payment_qr_image_url} alt="Payment QR" className="h-48 w-48 rounded bg-white object-contain p-2" />
        </section>
      )}

      {state.bill.status === "locked" && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">This bill is locked — no more changes.</p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}
    </main>
  );
}
