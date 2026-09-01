import { z } from "zod";
import { pool } from "../db/pool.js";
import { requirePayerAuth, requireBillOwner } from "../middleware/auth.js";
import { generateJoinCode, generateJoinLinkToken } from "../lib/joinCode.js";
import { extractReceipt } from "../lib/receiptExtraction.js";
import { saveImage } from "../lib/storage.js";
import { fetchFullBill } from "../lib/billState.js";

const createBillSchema = z.object({ title: z.string().min(1).max(200).optional() });
const editItemsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        unit_price: z.number().nonnegative(),
        quantity: z.number().positive(),
      })
    )
    .min(1),
  subtotal: z.number().nonnegative(),
  tax_amount: z.number().nonnegative(),
  service_charge_amount: z.number().nonnegative(),
  total: z.number().nonnegative(),
});
const paymentQrSchema = z.object({ methodType: z.enum(["bank", "tng"]) });
const titleSchema = z.object({ title: z.string().trim().min(1).max(200) });

export default async function billsRoutes(fastify) {
  // List the payer's own bills, newest first - for the dashboard's bill history.
  fastify.get("/api/bills", { preHandler: requirePayerAuth }, async (request, reply) => {
    const result = await pool.query(
      "SELECT * FROM bills WHERE owner_user_id = $1 ORDER BY created_at DESC",
      [request.payerUserId]
    );
    return reply.send(result.rows);
  });

  // Create a draft bill
  fastify.post("/api/bills", { preHandler: requirePayerAuth }, async (request, reply) => {
    const parsed = createBillSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_BODY", message: parsed.error.message });

    const bill = await pool.query(
      `INSERT INTO bills (owner_user_id, title, join_code, join_link_token)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [request.payerUserId, parsed.data.title ?? null, generateJoinCode(), generateJoinLinkToken()]
    );

    await pool.query(
      `INSERT INTO participants (bill_id, user_id, is_payer) VALUES ($1, $2, true)`,
      [bill.rows[0].id, request.payerUserId]
    );

    return reply.code(201).send(bill.rows[0]);
  });

  // Upload receipt image, run LLM extraction, store as draft item list.
  // Rate-limited per payer since every call is a paid LLM request (SplitBillplan.md section 5, Phase 1).
  fastify.post(
    "/api/bills/:billId/receipt",
    {
      preHandler: [requirePayerAuth, requireBillOwner],
      config: {
        rateLimit: { max: 10, timeWindow: "10 minutes", keyGenerator: (req) => req.payerUserId },
      },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "MISSING_FILE", message: "No receipt image uploaded" });

      const buffer = await file.toBuffer();
      const imageUrl = await saveImage(buffer, file.mimetype);
      const extracted = await extractReceipt(buffer, file.mimetype);

      await pool.query("DELETE FROM items WHERE bill_id = $1", [request.params.billId]);
      for (const [index, item] of extracted.items.entries()) {
        await pool.query(
          `INSERT INTO items (bill_id, name, unit_price, quantity, raw_line_text, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [request.params.billId, item.name, item.unit_price, item.quantity, item.raw_line_text ?? null, index]
        );
      }

      const updated = await pool.query(
        `UPDATE bills SET raw_receipt_image_url = $1, subtotal = $2, tax_amount = $3,
           service_charge_amount = $4, total = $5, currency = COALESCE($6, currency)
         WHERE id = $7 RETURNING *`,
        [
          imageUrl,
          extracted.subtotal,
          extracted.tax_amount,
          extracted.service_charge_amount,
          extracted.total,
          extracted.currency ?? null,
          request.params.billId,
        ]
      );

      return reply.send({ bill: updated.rows[0], items: extracted.items });
    }
  );

  // Renaming is allowed regardless of bill status - it's just a label, no claim/total implications.
  fastify.patch("/api/bills/:billId/title", { preHandler: [requirePayerAuth, requireBillOwner] }, async (request, reply) => {
    const parsed = titleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_BODY", message: parsed.error.message });

    const updated = await pool.query(`UPDATE bills SET title = $1 WHERE id = $2 RETURNING *`, [
      parsed.data.title,
      request.params.billId,
    ]);
    return reply.send(updated.rows[0]);
  });

  // Payer reviews/corrects the extracted items before publishing - never auto-published.
  fastify.put("/api/bills/:billId/items", { preHandler: [requirePayerAuth, requireBillOwner] }, async (request, reply) => {
    const parsed = editItemsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_BODY", message: parsed.error.message });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM items WHERE bill_id = $1", [request.params.billId]);
      for (const [index, item] of parsed.data.items.entries()) {
        await client.query(
          `INSERT INTO items (bill_id, name, unit_price, quantity, sort_order) VALUES ($1, $2, $3, $4, $5)`,
          [request.params.billId, item.name, item.unit_price, item.quantity, index]
        );
      }
      await client.query(
        `UPDATE bills SET subtotal = $1, tax_amount = $2, service_charge_amount = $3, total = $4 WHERE id = $5`,
        [parsed.data.subtotal, parsed.data.tax_amount, parsed.data.service_charge_amount, parsed.data.total, request.params.billId]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return reply.send({ ok: true });
  });

  // Publish: bill becomes joinable. Requires at least one item.
  fastify.post("/api/bills/:billId/publish", { preHandler: [requirePayerAuth, requireBillOwner] }, async (request, reply) => {
    const items = await pool.query("SELECT id FROM items WHERE bill_id = $1", [request.params.billId]);
    if (items.rows.length === 0) {
      return reply.code(400).send({ code: "NO_ITEMS", message: "Add at least one item before publishing" });
    }
    const updated = await pool.query(
      `UPDATE bills SET status = 'open', join_code_expires_at = now() + interval '30 minutes'
       WHERE id = $1 AND status = 'draft' RETURNING *`,
      [request.params.billId]
    );
    if (updated.rows.length === 0) {
      return reply.code(409).send({ code: "ALREADY_PUBLISHED", message: "Bill is not in draft status" });
    }
    return reply.send(updated.rows[0]);
  });

  fastify.post("/api/bills/:billId/payment-qr", { preHandler: [requirePayerAuth, requireBillOwner] }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "MISSING_FILE", message: "No QR image uploaded" });
    const fields = file.fields ?? {};
    const parsed = paymentQrSchema.safeParse({ methodType: fields.methodType?.value });
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_BODY", message: parsed.error.message });

    const buffer = await file.toBuffer();
    const qrUrl = await saveImage(buffer, file.mimetype);
    const updated = await pool.query(
      `UPDATE bills SET payment_qr_image_url = $1, payment_method_type = $2 WHERE id = $3 RETURNING *`,
      [qrUrl, parsed.data.methodType, request.params.billId]
    );
    return reply.send(updated.rows[0]);
  });

  // Copies the payer's saved default QR (see routes/me.js) onto this bill, so they
  // don't have to re-upload the same QR image for every new bill.
  fastify.post(
    "/api/bills/:billId/use-default-payment",
    { preHandler: [requirePayerAuth, requireBillOwner] },
    async (request, reply) => {
      const owner = await pool.query(
        "SELECT default_payment_qr_image_url, default_payment_method_type FROM users WHERE id = $1",
        [request.payerUserId]
      );
      const { default_payment_qr_image_url, default_payment_method_type } = owner.rows[0] ?? {};
      if (!default_payment_qr_image_url) {
        return reply.code(400).send({ code: "NO_DEFAULT_QR", message: "No default payment QR set in Settings" });
      }

      const updated = await pool.query(
        `UPDATE bills SET payment_qr_image_url = $1, payment_method_type = $2 WHERE id = $3 RETURNING *`,
        [default_payment_qr_image_url, default_payment_method_type, request.params.billId]
      );
      return reply.send(updated.rows[0]);
    }
  );

  fastify.get("/api/bills/:billId", { preHandler: [requirePayerAuth, requireBillOwner] }, async (request, reply) => {
    const bill = await fetchFullBill(request.params.billId);
    if (!bill) return reply.code(404).send({ code: "NOT_FOUND", message: "Bill not found" });

    const owner = await pool.query(
      "SELECT default_payment_qr_image_url, default_payment_method_type FROM users WHERE id = $1",
      [request.payerUserId]
    );
    const payerDefaultPaymentQr = owner.rows[0]?.default_payment_qr_image_url
      ? {
          url: owner.rows[0].default_payment_qr_image_url,
          methodType: owner.rows[0].default_payment_method_type,
        }
      : null;

    return reply.send({ ...bill, payerDefaultPaymentQr });
  });

  fastify.post(
    "/api/bills/:billId/payments/:participantId/mark-paid",
    { preHandler: [requirePayerAuth, requireBillOwner] },
    async (request, reply) => {
      await pool.query(
        `INSERT INTO payments (bill_id, participant_id, amount_owed, marked_paid_by_payer, marked_paid_at)
         VALUES ($1, $2, $3, true, now())
         ON CONFLICT DO NOTHING`,
        [request.params.billId, request.params.participantId, 0]
      );
      await pool.query(
        `UPDATE payments SET marked_paid_by_payer = true, marked_paid_at = now()
         WHERE bill_id = $1 AND participant_id = $2`,
        [request.params.billId, request.params.participantId]
      );
      return reply.send({ ok: true });
    }
  );
}
