import { pool } from "../db/pool.js";
import { computeBillTotals } from "./totals.js";

/** Full snapshot of a bill: row + items + participants + claims + computed totals. Never trusts client-sent totals (see SplitBillplan.md section 4, reconciliation rule). */
export async function fetchFullBill(billId) {
  const billResult = await pool.query("SELECT * FROM bills WHERE id = $1", [billId]);
  if (billResult.rows.length === 0) return null;
  const bill = billResult.rows[0];

  const [items, participants, claims, payments, adjustments] = await Promise.all([
    pool.query("SELECT * FROM items WHERE bill_id = $1 ORDER BY sort_order", [billId]),
    pool.query(
      `SELECT p.*, COALESCE(p.guest_name, u.name) AS display_name
       FROM participants p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.bill_id = $1 ORDER BY p.joined_at`,
      [billId]
    ),
    pool.query(
      `SELECT ic.* FROM item_claims ic JOIN items i ON i.id = ic.item_id WHERE i.bill_id = $1`,
      [billId]
    ),
    pool.query("SELECT * FROM payments WHERE bill_id = $1", [billId]),
    pool.query("SELECT * FROM bill_adjustments WHERE bill_id = $1 ORDER BY created_at", [billId]),
  ]);

  const totals = computeBillTotals({
    items: items.rows,
    claims: claims.rows,
    participants: participants.rows,
    taxAmount: bill.tax_amount,
    serviceChargeAmount: bill.service_charge_amount,
  });

  return {
    bill,
    items: items.rows,
    participants: participants.rows,
    claims: claims.rows,
    payments: payments.rows,
    adjustments: adjustments.rows,
    totals,
  };
}
