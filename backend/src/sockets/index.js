import { pool } from "../db/pool.js";
import { verifyGuestToken, verifyFirebaseToken, hashToken } from "../lib/auth.js";
import { fetchFullBill } from "../lib/billState.js";
import { computeItemClaimTotals } from "../lib/totals.js";
import { parseAdjustmentInstruction } from "../lib/chatAdjustment.js";
import { validateAdjustmentDiff, applyAdjustmentDiff } from "../lib/applyAdjustment.js";

const EPSILON = 1e-6;

function sendError(socket, code, message) {
  socket.emit("error", { code, message });
}

/** Re-derives full state server-side and broadcasts it - see reconciliation rule in SplitBillplan.md section 4. */
async function broadcastTotals(io, billId) {
  const state = await fetchFullBill(billId);
  if (!state) return;
  io.to(`bill:${billId}`).emit("totals:updated", { perParticipantTotals: state.totals.perParticipant });
}

/** Applies a validated diff, persists the adjustment's final status, and broadcasts the result to the room. */
async function applyAndBroadcastAdjustment(io, billId, diff, adjustmentId, reviewerParticipantId) {
  await applyAdjustmentDiff(billId, diff);
  await pool.query(
    `UPDATE bill_adjustments SET status = 'applied', reviewed_by_participant_id = $1, reviewed_at = now() WHERE id = $2`,
    [reviewerParticipantId, adjustmentId]
  );

  const state = await fetchFullBill(billId);
  const adjustment = state.adjustments.find((a) => a.id === adjustmentId);
  io.to(`bill:${billId}`).emit("adjustment:applied", {
    adjustment,
    updatedState: { items: state.items, claims: state.claims, totals: state.totals },
  });
}

async function resolveIdentity(billId, token) {
  // Guest session token first (stateless JWT; hash-compare against the revocable stored hash).
  try {
    const payload = verifyGuestToken(token);
    if (payload.billId !== billId) return null;
    const participant = await pool.query(
      "SELECT * FROM participants WHERE id = $1 AND bill_id = $2 AND is_payer = false",
      [payload.participantId, billId]
    );
    if (participant.rows.length === 0) return null;
    if (participant.rows[0].guest_session_token_hash !== hashToken(token)) return null; // revoked
    return { participantId: participant.rows[0].id, isPayer: false };
  } catch {
    // Not a valid guest token - fall through to payer auth.
  }

  try {
    const decoded = await verifyFirebaseToken(token);
    const user = await pool.query("SELECT id FROM users WHERE firebase_uid = $1", [decoded.uid]);
    if (user.rows.length === 0) return null;
    const participant = await pool.query(
      "SELECT * FROM participants WHERE bill_id = $1 AND user_id = $2 AND is_payer = true",
      [billId, user.rows[0].id]
    );
    if (participant.rows.length === 0) return null;
    return { participantId: participant.rows[0].id, isPayer: true };
  } catch {
    return null;
  }
}

export function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("bill:join", async ({ billId, token }) => {
      const identity = await resolveIdentity(billId, token);
      if (!identity) return sendError(socket, "UNAUTHENTICATED", "Invalid or expired session token");

      socket.data.billId = billId;
      socket.data.participantId = identity.participantId;
      socket.data.isPayer = identity.isPayer;
      socket.join(`bill:${billId}`);

      const state = await fetchFullBill(billId);
      if (!state) return sendError(socket, "NOT_FOUND", "Bill not found");
      // bill:state is only ever emitted directly to the joining socket (never broadcast),
      // so it's safe to attach the viewer's own participant id here.
      socket.emit("bill:state", { ...state, yourParticipantId: identity.participantId });
      socket.to(`bill:${billId}`).emit("participant:joined", {
        participant: state.participants.find((p) => p.id === identity.participantId),
      });
    });

    socket.on("item:claim", async ({ itemId, shareFraction }) => {
      const { billId, participantId } = socket.data;
      if (!billId) return sendError(socket, "UNAUTHENTICATED", "Join the bill first");
      if (!(shareFraction > 0 && shareFraction <= 1)) {
        return sendError(socket, "INVALID_SHARE", "shareFraction must be between 0 (exclusive) and 1");
      }

      const bill = await pool.query("SELECT status FROM bills WHERE id = $1", [billId]);
      if (bill.rows[0]?.status !== "open") {
        return sendError(socket, "BILL_NOT_OPEN", "This bill is not accepting claims");
      }

      const item = await pool.query("SELECT id FROM items WHERE id = $1 AND bill_id = $2", [itemId, billId]);
      if (item.rows.length === 0) return sendError(socket, "NOT_FOUND", "Item not found on this bill");

      const claims = await pool.query(
        "SELECT participant_id, share_fraction FROM item_claims WHERE item_id = $1",
        [itemId]
      );
      const othersTotal = claims.rows
        .filter((c) => c.participant_id !== participantId)
        .reduce((sum, c) => sum + Number(c.share_fraction), 0);
      if (othersTotal + shareFraction > 1 + EPSILON) {
        return sendError(socket, "OVER_CLAIMED", "This item is already fully or partially claimed by others");
      }

      await pool.query(
        `INSERT INTO item_claims (item_id, participant_id, share_fraction) VALUES ($1, $2, $3)
         ON CONFLICT (item_id, participant_id) DO UPDATE SET share_fraction = EXCLUDED.share_fraction`,
        [itemId, participantId, shareFraction]
      );

      io.to(`bill:${billId}`).emit("item:claimed", { itemId, participantId, shareFraction });
      await broadcastTotals(io, billId);
    });

    socket.on("item:unclaim", async ({ itemId }) => {
      const { billId, participantId } = socket.data;
      if (!billId) return sendError(socket, "UNAUTHENTICATED", "Join the bill first");

      await pool.query("DELETE FROM item_claims WHERE item_id = $1 AND participant_id = $2", [
        itemId,
        participantId,
      ]);

      io.to(`bill:${billId}`).emit("item:unclaimed", { itemId, participantId });
      await broadcastTotals(io, billId);
    });

    socket.on("bill:lock", async () => {
      const { billId, isPayer } = socket.data;
      if (!billId) return sendError(socket, "UNAUTHENTICATED", "Join the bill first");
      if (!isPayer) return sendError(socket, "FORBIDDEN", "Only the payer can lock the bill");

      const [items, claims] = await Promise.all([
        pool.query("SELECT * FROM items WHERE bill_id = $1", [billId]),
        pool.query(
          "SELECT ic.* FROM item_claims ic JOIN items i ON i.id = ic.item_id WHERE i.bill_id = $1",
          [billId]
        ),
      ]);
      const { unresolvedItemIds } = computeItemClaimTotals(items.rows, claims.rows);
      if (unresolvedItemIds.length > 0) {
        return sendError(socket, "UNRESOLVED_ITEMS", "Resolve all unclaimed items before locking");
      }

      await pool.query("UPDATE bills SET status = 'locked', locked_at = now() WHERE id = $1", [billId]);
      io.to(`bill:${billId}`).emit("bill:locked", {});
    });

    socket.on("payment:mark_paid", async ({ participantId }) => {
      const { billId, isPayer } = socket.data;
      if (!billId) return sendError(socket, "UNAUTHENTICATED", "Join the bill first");
      if (!isPayer) return sendError(socket, "FORBIDDEN", "Only the payer can mark payments");

      const state = await fetchFullBill(billId);
      const owed = state.totals.perParticipant.find((p) => p.participantId === participantId)?.total ?? 0;

      await pool.query(
        `INSERT INTO payments (bill_id, participant_id, amount_owed, marked_paid_by_payer, marked_paid_at)
         VALUES ($1, $2, $3, true, now())
         ON CONFLICT DO NOTHING`,
        [billId, participantId, owed]
      );
      await pool.query(
        `UPDATE payments SET marked_paid_by_payer = true, marked_paid_at = now(), amount_owed = $3
         WHERE bill_id = $1 AND participant_id = $2`,
        [billId, participantId, owed]
      );

      io.to(`bill:${billId}`).emit("payment:updated", { participantId, markedPaid: true });
    });

    socket.on("chat:propose_adjustment", async ({ instructionText }) => {
      const { billId, participantId, isPayer } = socket.data;
      if (!billId) return sendError(socket, "UNAUTHENTICATED", "Join the bill first");
      if (!instructionText || typeof instructionText !== "string" || instructionText.length > 500) {
        return sendError(socket, "INVALID_INSTRUCTION", "Instruction must be 1-500 characters");
      }

      const bill = await pool.query("SELECT status FROM bills WHERE id = $1", [billId]);
      if (bill.rows[0]?.status !== "open") {
        return sendError(socket, "BILL_NOT_OPEN", "This bill is not accepting adjustments");
      }

      const [items, participants] = await Promise.all([
        pool.query("SELECT * FROM items WHERE bill_id = $1", [billId]),
        pool.query("SELECT * FROM participants WHERE bill_id = $1", [billId]),
      ]);
      const context = { items: items.rows, participants: participants.rows };

      let diff;
      try {
        diff = await parseAdjustmentInstruction(instructionText, context);
      } catch (err) {
        return sendError(socket, "ADJUSTMENT_FAILED", `Couldn't process that request: ${err.message}`);
      }

      const validation = validateAdjustmentDiff(diff, context);
      if (!validation.valid) {
        return sendError(socket, "ADJUSTMENT_INVALID", diff.summary || validation.reason);
      }

      const inserted = await pool.query(
        `INSERT INTO bill_adjustments (bill_id, proposed_by_participant_id, instruction_text, structured_diff, status)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
        [billId, participantId, instructionText, JSON.stringify(diff)]
      );
      const adjustmentId = inserted.rows[0].id;

      if (isPayer) {
        // Payer-initiated adjustments apply immediately - no approval step needed (SplitBillplan.md Phase 3).
        await applyAndBroadcastAdjustment(io, billId, diff, adjustmentId, participantId);
      } else {
        const state = await fetchFullBill(billId);
        const adjustment = state.adjustments.find((a) => a.id === adjustmentId);
        io.to(`bill:${billId}`).emit("adjustment:proposed", { adjustment });
      }
    });

    socket.on("adjustment:review", async ({ adjustmentId, decision }) => {
      const { billId, participantId, isPayer } = socket.data;
      if (!billId) return sendError(socket, "UNAUTHENTICATED", "Join the bill first");
      if (!isPayer) return sendError(socket, "FORBIDDEN", "Only the payer can review adjustments");
      if (decision !== "approved" && decision !== "rejected") {
        return sendError(socket, "INVALID_DECISION", "decision must be 'approved' or 'rejected'");
      }

      const pending = await pool.query(
        "SELECT * FROM bill_adjustments WHERE id = $1 AND bill_id = $2 AND status = 'pending'",
        [adjustmentId, billId]
      );
      if (pending.rows.length === 0) {
        return sendError(socket, "NOT_FOUND", "No pending adjustment with that id");
      }

      if (decision === "rejected") {
        await pool.query(
          `UPDATE bill_adjustments SET status = 'rejected', reviewed_by_participant_id = $1, reviewed_at = now() WHERE id = $2`,
          [participantId, adjustmentId]
        );
        io.to(`bill:${billId}`).emit("adjustment:rejected", { adjustmentId });
        return;
      }

      // Re-validate against current state before approving - claims may have changed since it was proposed.
      const [items, participants] = await Promise.all([
        pool.query("SELECT * FROM items WHERE bill_id = $1", [billId]),
        pool.query("SELECT * FROM participants WHERE bill_id = $1", [billId]),
      ]);
      const diff = pending.rows[0].structured_diff;
      const validation = validateAdjustmentDiff(diff, { items: items.rows, participants: participants.rows });
      if (!validation.valid) {
        await pool.query(
          `UPDATE bill_adjustments SET status = 'rejected', reviewed_by_participant_id = $1, reviewed_at = now() WHERE id = $2`,
          [participantId, adjustmentId]
        );
        io.to(`bill:${billId}`).emit("adjustment:rejected", { adjustmentId });
        return sendError(socket, "ADJUSTMENT_INVALID", "This adjustment no longer applies - " + validation.reason);
      }

      await applyAndBroadcastAdjustment(io, billId, diff, adjustmentId, participantId);
    });
  });
}
