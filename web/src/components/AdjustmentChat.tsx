"use client";

import { useState } from "react";
import type { Adjustment, Participant } from "@/lib/types";

const STATUS_STYLE: Record<Adjustment["status"], string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  applied: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function participantLabel(participants: Participant[], id: string) {
  const p = participants.find((p) => p.id === id);
  if (!p) return "Someone";
  return p.is_payer ? `${p.guest_name ?? "Payer"} (payer)` : p.guest_name ?? "Guest";
}

export function AdjustmentChat({
  adjustments,
  participants,
  isPayer,
  error,
  onPropose,
  onReview,
}: {
  adjustments: Adjustment[];
  participants: Participant[];
  isPayer: boolean;
  error: { code: string; message: string } | null;
  onPropose: (instructionText: string) => void;
  onReview: (adjustmentId: string, decision: "approved" | "rejected") => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Adjusting state during render (React's documented pattern for "reset when
  // a prop changes") instead of an effect: a new adjustment or error means the
  // server has responded, so the in-flight request is done.
  const [trackedAdjustmentCount, setTrackedAdjustmentCount] = useState(adjustments.length);
  const [trackedError, setTrackedError] = useState(error);
  if (adjustments.length !== trackedAdjustmentCount || error !== trackedError) {
    setTrackedAdjustmentCount(adjustments.length);
    setTrackedError(error);
    setSending(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onPropose(text.trim());
    setText("");
    setSending(true);
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Ask for a change</h2>
      <form onSubmit={handleSubmit} className="mb-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. split the cake 3 ways"
          disabled={sending}
          className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {sending ? "…" : isPayer ? "Apply" : "Ask"}
        </button>
      </form>

      {adjustments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {[...adjustments].reverse().map((adj) => (
            <li
              key={adj.id}
              className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <p>
                  <span className="font-medium">{participantLabel(participants, adj.proposed_by_participant_id)}</span>
                  {": “"}
                  {adj.instruction_text}
                  {"”"}
                </p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[adj.status]}`}>
                  {adj.status}
                </span>
              </div>
              {adj.structured_diff?.summary && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{adj.structured_diff.summary}</p>
              )}
              {isPayer && adj.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => onReview(adj.id, "approved")}
                    className="rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onReview(adj.id, "rejected")}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
