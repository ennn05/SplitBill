const EPSILON = 1e-6;

/**
 * Given amounts (currency units, e.g. dollars) that should sum to `targetTotal`,
 * returns integer cents per amount that sum to exactly round(targetTotal * 100).
 * Plain per-amount rounding can drift the visible total by a cent or two when
 * claims are uneven; largest-remainder allocation keeps "sum of what everyone
 * owes" exactly equal to the bill total, which matters because people compare.
 */
function allocateCentsByLargestRemainder(amounts, targetTotal) {
  const targetCents = Math.round(targetTotal * 100);
  const floors = amounts.map((a) => Math.floor(a * 100));
  const remainders = amounts.map((a, i) => a * 100 - floors[i]);
  let allocated = floors.reduce((sum, c) => sum + c, 0);
  let remainingCents = targetCents - allocated;

  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r);

  const result = [...floors];
  for (let k = 0; k < order.length && remainingCents > 0; k++, remainingCents--) {
    result[order[k].i] += 1;
  }
  // If floating point pushed us negative (over-allocated), pull back from smallest remainders.
  for (let k = order.length - 1; k >= 0 && remainingCents < 0; k--, remainingCents++) {
    result[order[k].i] -= 1;
  }
  return result;
}

/**
 * Computes each item's claimed fraction and flags items that aren't fully
 * claimed yet (SUM(share_fraction) < 1). Used both to reject over-claims on
 * `item:claim` and to block `bill:lock` (see SplitBillplan.md section 2, step 7a).
 */
export function computeItemClaimTotals(items, claims) {
  const claimedByItem = new Map();
  for (const claim of claims) {
    claimedByItem.set(
      claim.item_id,
      (claimedByItem.get(claim.item_id) ?? 0) + Number(claim.share_fraction)
    );
  }
  const unresolvedItemIds = items
    .filter((item) => (claimedByItem.get(item.id) ?? 0) < 1 - EPSILON)
    .map((item) => item.id);

  return { claimedByItem, unresolvedItemIds };
}

/**
 * Full per-participant breakdown: item subtotal, proportional tax/service
 * share, and final total owed. Tax/service are never stored per-participant
 * (see schema design notes) - always recomputed here from current claims so
 * they can't drift out of sync.
 */
export function computeBillTotals({ items, claims, participants, taxAmount, serviceChargeAmount }) {
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const rawSubtotalByParticipant = new Map(participants.map((p) => [p.id, 0]));
  for (const claim of claims) {
    const item = itemsById.get(claim.item_id);
    if (!item) continue;
    const lineValue = Number(item.unit_price) * Number(item.quantity) * Number(claim.share_fraction);
    rawSubtotalByParticipant.set(
      claim.participant_id,
      (rawSubtotalByParticipant.get(claim.participant_id) ?? 0) + lineValue
    );
  }

  const billSubtotal = items.reduce((sum, i) => sum + Number(i.unit_price) * Number(i.quantity), 0);
  const orderedParticipantIds = [...rawSubtotalByParticipant.keys()];
  const rawSubtotals = orderedParticipantIds.map((id) => rawSubtotalByParticipant.get(id));

  const rawExtrasByParticipant = orderedParticipantIds.map((_, i) => {
    const share = billSubtotal > EPSILON ? rawSubtotals[i] / billSubtotal : 0;
    return share * (Number(taxAmount) + Number(serviceChargeAmount));
  });
  const rawTotals = rawSubtotals.map((s, i) => s + rawExtrasByParticipant[i]);

  // Reconcile against the sum of what's actually claimed, not the full bill amount -
  // those only match once every item is fully claimed. Reconciling against the full
  // bill total while items are still unclaimed would leak phantom cents from nobody's
  // share onto whichever participant the remainder happened to land on.
  const claimedSubtotalSum = rawSubtotals.reduce((sum, s) => sum + s, 0);
  const claimedTotalSum = rawTotals.reduce((sum, t) => sum + t, 0);
  const totalCents = allocateCentsByLargestRemainder(rawTotals, claimedTotalSum);
  const subtotalCents = allocateCentsByLargestRemainder(rawSubtotals, claimedSubtotalSum);

  const { unresolvedItemIds } = computeItemClaimTotals(items, claims);

  return {
    unresolvedItemIds,
    perParticipant: orderedParticipantIds.map((participantId, i) => ({
      participantId,
      subtotal: subtotalCents[i] / 100,
      taxAndServiceShare: (totalCents[i] - subtotalCents[i]) / 100,
      total: totalCents[i] / 100,
    })),
  };
}
