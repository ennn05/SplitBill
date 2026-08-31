"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/lib/AuthContext";
import { useBillSocket } from "@/lib/useBillSocket";
import { getBill, uploadReceipt, saveItems, publishBill, uploadPaymentQr } from "@/lib/api";
import { unresolvedItems } from "@/lib/claims";
import { BillItemsList } from "@/components/BillItemsList";
import type { BillState, ExtractedItem } from "@/lib/types";

export default function BillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = use(params);
  const { user, loading: authLoading, getIdToken } = useAuth();
  const router = useRouter();

  const [idToken, setIdToken] = useState<string | null>(null);
  const [restState, setRestState] = useState<BillState | null>(null);
  const [restError, setRestError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    getIdToken().then(setIdToken);
  }, [user, getIdToken]);

  const refresh = useCallback(async () => {
    if (!idToken) return;
    try {
      setRestState(await getBill(idToken, billId));
    } catch (err) {
      setRestError(err instanceof Error ? err.message : "Failed to load bill");
    }
  }, [idToken, billId]);

  useEffect(() => {
    // Genuine data fetch (network I/O, not synchronously-derived state) tied to route
    // params - `refresh` is also called imperatively from child onChanged callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const isLive = restState && restState.bill.status !== "draft";
  const live = useBillSocket(isLive ? billId : null, isLive ? idToken : null);

  if (authLoading || !user || !restState) {
    return <p className="p-8 text-center text-slate-500">Loading…</p>;
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{restState.bill.title || "Untitled bill"}</h1>
      {restError && <p className="text-sm text-red-600">{restError}</p>}

      {restState.bill.status === "draft" ? (
        <DraftEditor
          // Remounts (resetting the local editable copy below) whenever a fresh receipt
          // is extracted server-side - avoids an effect just to re-sync props into state.
          key={restState.bill.raw_receipt_image_url ?? "no-receipt"}
          idToken={idToken!}
          billId={billId}
          state={restState}
          onChanged={refresh}
        />
      ) : (
        <LiveBillPanel state={live.state} error={live.error} liveActions={live} idToken={idToken!} billId={billId} onQrUploaded={refresh} bill={restState.bill} />
      )}
    </main>
  );
}

function DraftEditor({
  idToken,
  billId,
  state,
  onChanged,
}: {
  idToken: string;
  billId: string;
  state: BillState;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<ExtractedItem[]>(() =>
    state.items.map((i) => ({ name: i.name, unit_price: Number(i.unit_price), quantity: Number(i.quantity) }))
  );
  const [tax, setTax] = useState(() => Number(state.bill.tax_amount));
  const [service, setService] = useState(() => Number(state.bill.service_charge_amount));

  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const total = subtotal + tax + service;

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadReceipt(idToken, billId, file);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receipt extraction failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveItems(idToken, billId, { items, subtotal, tax_amount: tax, service_charge_amount: service, total });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save items");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      await handleSave();
      await publishBill(idToken, billId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setPublishing(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-600">Upload a photo or screenshot of the receipt.</p>
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
          className="mx-auto text-sm"
        />
        {uploading && <p className="text-sm text-slate-500">Reading receipt…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Review what was extracted — fix anything wrong before publishing. Nothing is shared with guests yet.
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-center gap-2 rounded border border-slate-200 p-2">
            <input
              value={item.name}
              onChange={(e) =>
                setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, name: e.target.value } : it)))
              }
              className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm"
            />
            <input
              type="number"
              step="0.01"
              value={item.quantity}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((it, i) => (i === idx ? { ...it, quantity: Number(e.target.value) } : it))
                )
              }
              className="w-16 rounded border border-slate-200 px-2 py-1 text-sm"
              title="Quantity"
            />
            <input
              type="number"
              step="0.01"
              value={item.unit_price}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((it, i) => (i === idx ? { ...it, unit_price: Number(e.target.value) } : it))
                )
              }
              className="w-20 rounded border border-slate-200 px-2 py-1 text-sm"
              title="Unit price"
            />
            <button
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
              className="text-xs text-red-500"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setItems((prev) => [...prev, { name: "", unit_price: 0, quantity: 1 }])}
        className="self-start text-sm text-slate-500 hover:underline"
      >
        + Add item
      </button>

      <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 p-3 text-sm">
        <label className="flex items-center justify-between gap-2">
          Tax
          <input
            type="number"
            step="0.01"
            value={tax}
            onChange={(e) => setTax(Number(e.target.value))}
            className="w-24 rounded border border-slate-200 px-2 py-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Service charge
          <input
            type="number"
            step="0.01"
            value={service}
            onChange={(e) => setService(Number(e.target.value))}
            className="w-24 rounded border border-slate-200 px-2 py-1"
          />
        </label>
        <p className="col-span-2 text-right font-medium">Total: RM {total.toFixed(2)}</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || publishing}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing || items.length === 0}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {publishing ? "Publishing…" : "Publish & get join link"}
        </button>
      </div>
    </div>
  );
}

function LiveBillPanel({
  state,
  error,
  liveActions,
  idToken,
  billId,
  bill,
  onQrUploaded,
}: {
  state: ReturnType<typeof useBillSocket>["state"];
  error: ReturnType<typeof useBillSocket>["error"];
  liveActions: ReturnType<typeof useBillSocket>;
  idToken: string;
  billId: string;
  bill: BillState["bill"];
  onQrUploaded: () => void;
}) {
  const [qrMethod, setQrMethod] = useState<"bank" | "tng">("bank");
  const [qrUploading, setQrUploading] = useState(false);

  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/join/${bill.join_link_token}` : "";

  async function handleQrUpload(file: File) {
    setQrUploading(true);
    try {
      await uploadPaymentQr(idToken, billId, file, qrMethod);
      onQrUploaded();
    } finally {
      setQrUploading(false);
    }
  }

  if (!state) return <p className="text-slate-500">Connecting…</p>;

  const stillUnresolved = unresolvedItems(state.items, state.claims);
  const totalsByParticipant = new Map(state.totals.perParticipant.map((t) => [t.participantId, t]));
  const paidByParticipant = new Map(state.payments.map((p) => [p.participant_id, p.marked_paid_by_payer]));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">Share this to let people join</p>
        {joinUrl && <QRCodeSVG value={joinUrl} size={140} />}
        <p className="break-all text-center text-xs text-slate-500">{joinUrl}</p>
        <p className="text-sm">
          Backup code: <span className="font-mono font-semibold">{bill.join_code}</span>
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700">Items</h2>
        <BillItemsList
          items={state.items}
          claims={state.claims}
          participants={state.participants}
          myParticipantId={state.yourParticipantId}
          onClaim={liveActions.claimItem}
          onUnclaim={liveActions.unclaimItem}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700">Who owes what</h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {state.participants.map((p) => {
            const t = totalsByParticipant.get(p.id);
            const paid = paidByParticipant.get(p.id);
            return (
              <li key={p.id} className="flex items-center justify-between p-3 text-sm">
                <span>{p.guest_name ?? "Payer"}{p.is_payer && " (payer)"}</span>
                <span className="flex items-center gap-3">
                  RM {(t?.total ?? 0).toFixed(2)}
                  {!p.is_payer &&
                    (paid ? (
                      <span className="text-xs text-green-600">Paid</span>
                    ) : (
                      <button
                        onClick={() => liveActions.markPaid(p.id)}
                        className="rounded-full bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
                      >
                        Mark paid
                      </button>
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-slate-700">Payment QR</h2>
        {bill.payment_qr_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bill.payment_qr_image_url} alt="Payment QR" className="h-40 w-40 object-contain" />
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={qrMethod}
              onChange={(e) => setQrMethod(e.target.value as "bank" | "tng")}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="bank">Bank transfer</option>
              <option value="tng">Touch &apos;n Go</option>
            </select>
            <input
              type="file"
              accept="image/*"
              disabled={qrUploading}
              onChange={(e) => e.target.files?.[0] && handleQrUpload(e.target.files[0])}
              className="text-sm"
            />
          </div>
        )}
      </section>

      {bill.status === "open" && (
        <button
          onClick={liveActions.lockBill}
          disabled={stillUnresolved.length > 0}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {stillUnresolved.length > 0
            ? `Resolve ${stillUnresolved.length} unclaimed item(s) before locking`
            : "Lock bill"}
        </button>
      )}
      {bill.status === "locked" && <p className="text-sm font-medium text-slate-600">Bill is locked.</p>}

      {error && <p className="text-sm text-red-600">{error.message}</p>}
    </div>
  );
}
