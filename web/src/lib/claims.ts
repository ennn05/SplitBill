import type { Item, ItemClaim } from "./types";

const EPSILON = 1e-6;

/** Mirrors backend/src/lib/totals.js computeItemClaimTotals so the UI can show claim progress instantly, without waiting on a round trip. */
export function claimedFractionByItem(claims: ItemClaim[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const claim of claims) {
    map.set(claim.item_id, (map.get(claim.item_id) ?? 0) + Number(claim.share_fraction));
  }
  return map;
}

export function isItemFullyClaimed(itemId: string, claimedByItem: Map<string, number>): boolean {
  return (claimedByItem.get(itemId) ?? 0) >= 1 - EPSILON;
}

export function unresolvedItems(items: Item[], claims: ItemClaim[]): Item[] {
  const claimedByItem = claimedFractionByItem(claims);
  return items.filter((item) => !isItemFullyClaimed(item.id, claimedByItem));
}
