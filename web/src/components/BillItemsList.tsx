"use client";

import { useState } from "react";
import type { Item, ItemClaim, Participant } from "@/lib/types";
import { claimedFractionByItem, isItemFullyClaimed } from "@/lib/claims";

const SPLIT_OPTIONS = [1, 2, 3, 4, 5, 6, 8];

function participantLabel(p: Participant) {
  return p.is_payer ? `${p.guest_name ?? "Payer"} (payer)` : p.guest_name ?? "Guest";
}

export function BillItemsList({
  items,
  claims,
  participants,
  myParticipantId,
  onClaim,
  onUnclaim,
  readOnly = false,
}: {
  items: Item[];
  claims: ItemClaim[];
  participants: Participant[];
  myParticipantId: string;
  onClaim: (itemId: string, shareFraction: number) => void;
  onUnclaim: (itemId: string) => void;
  readOnly?: boolean;
}) {
  const claimedByItem = claimedFractionByItem(claims);
  const participantsById = new Map(participants.map((p) => [p.id, p]));

  return (
    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
      {items.map((item) => {
        const itemClaims = claims.filter((c) => c.item_id === item.id);
        const myClaim = itemClaims.find((c) => c.participant_id === myParticipantId);
        const fullyClaimed = isItemFullyClaimed(item.id, claimedByItem);
        const lineTotal = Number(item.unit_price) * Number(item.quantity);

        return (
          <li key={item.id} className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">
                  {item.name} {Number(item.quantity) !== 1 && `× ${item.quantity}`}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">RM {lineTotal.toFixed(2)}</p>
              </div>
              {!readOnly && (
                <ClaimControl
                  claimed={Boolean(myClaim)}
                  fullyClaimed={fullyClaimed && !myClaim}
                  onClaim={(fraction) => onClaim(item.id, fraction)}
                  onUnclaim={() => onUnclaim(item.id)}
                />
              )}
            </div>

            {itemClaims.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Claimed by:{" "}
                {itemClaims
                  .map((c) => {
                    const p = participantsById.get(c.participant_id);
                    const frac = Number(c.share_fraction);
                    const label = p ? participantLabel(p) : "Someone";
                    return frac < 1 ? `${label} (${Math.round(frac * 100)}%)` : label;
                  })
                  .join(", ")}
                {!fullyClaimed && " — not fully claimed yet"}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ClaimControl({
  claimed,
  fullyClaimed,
  onClaim,
  onUnclaim,
}: {
  claimed: boolean;
  fullyClaimed: boolean;
  onClaim: (fraction: number) => void;
  onUnclaim: () => void;
}) {
  const [splitWays, setSplitWays] = useState(1);

  if (claimed) {
    return (
      <button
        onClick={onUnclaim}
        className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        Unclaim
      </button>
    );
  }

  if (fullyClaimed) {
    return <span className="shrink-0 text-xs text-slate-400 dark:text-slate-600">Fully claimed</span>;
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <select
        value={splitWays}
        onChange={(e) => setSplitWays(Number(e.target.value))}
        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
      >
        {SPLIT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n === 1 ? "Just me" : `Split ${n} ways`}
          </option>
        ))}
      </select>
      <button
        onClick={() => onClaim(1 / splitWays)}
        className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        Claim
      </button>
    </div>
  );
}
