import { pool } from "../db/pool.js";

const EPSILON = 1e-6;

/**
 * Validates a structured diff (from lib/chatAdjustment.js, or anything else
 * claiming to be one) against this bill's real items/participants. Never
 * trust a diff just because it parsed as JSON - the model can hallucinate
 * ids, and this is the one place that stands between chat input and actual
 * money-affecting database writes.
 */
export function validateAdjustmentDiff(diff, { items, participants }) {
  if (!diff || !Array.isArray(diff.operations) || diff.operations.length === 0) {
    return { valid: false, reason: "No changes were produced for that request." };
  }

  const itemIds = new Set(items.map((i) => i.id));
  const participantIds = new Set(participants.map((p) => p.id));

  for (const op of diff.operations) {
    if (!itemIds.has(op.itemId)) {
      return { valid: false, reason: `Unknown item in diff: ${op.itemId}` };
    }
    if (!Array.isArray(op.claims)) {
      return { valid: false, reason: "Malformed diff: claims must be an array" };
    }
    let sum = 0;
    const seen = new Set();
    for (const claim of op.claims) {
      if (!participantIds.has(claim.participantId)) {
        return { valid: false, reason: `Unknown participant in diff: ${claim.participantId}` };
      }
      if (seen.has(claim.participantId)) {
        return { valid: false, reason: "Duplicate participant claim on the same item in diff" };
      }
      seen.add(claim.participantId);
      if (!(claim.shareFraction > 0 && claim.shareFraction <= 1)) {
        return { valid: false, reason: "shareFraction must be between 0 (exclusive) and 1" };
      }
      sum += claim.shareFraction;
    }
    if (sum > 1 + EPSILON) {
      return { valid: false, reason: "A diff cannot claim more than 100% of a single item" };
    }
  }

  return { valid: true };
}

/** Replaces each operation's item claims wholesale, inside an already-open transaction. */
async function replaceClaims(client, billId, operations) {
  for (const op of operations) {
    await client.query(
      `DELETE FROM item_claims WHERE item_id = $1 AND item_id IN (SELECT id FROM items WHERE bill_id = $2)`,
      [op.itemId, billId]
    );
    for (const claim of op.claims) {
      await client.query(
        `INSERT INTO item_claims (item_id, participant_id, share_fraction) VALUES ($1, $2, $3)`,
        [op.itemId, claim.participantId, claim.shareFraction]
      );
    }
  }
}

/**
 * Applies an already-validated diff, first capturing a snapshot of each
 * affected item's claims as they stood immediately before - in the same
 * shape as diff.operations - so the change can be reverted later without
 * needing to compute or trust an inverse diff. Returns that snapshot.
 */
export async function applyAdjustmentDiff(billId, diff) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const previousClaims = [];
    for (const op of diff.operations) {
      const existing = await client.query(
        `SELECT participant_id, share_fraction FROM item_claims WHERE item_id = $1`,
        [op.itemId]
      );
      previousClaims.push({
        itemId: op.itemId,
        claims: existing.rows.map((r) => ({
          participantId: r.participant_id,
          shareFraction: Number(r.share_fraction),
        })),
      });
    }

    await replaceClaims(client, billId, diff.operations);

    await client.query("COMMIT");
    return previousClaims;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Restores claims to a previously-captured snapshot (see applyAdjustmentDiff). */
export async function revertToSnapshot(billId, previousClaims) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await replaceClaims(client, billId, previousClaims);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
