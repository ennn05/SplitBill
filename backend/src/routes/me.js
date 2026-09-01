import { z } from "zod";
import { pool } from "../db/pool.js";
import { requirePayerAuth } from "../middleware/auth.js";
import { saveImage } from "../lib/storage.js";

const paymentQrSchema = z.object({ methodType: z.enum(["bank", "tng"]) });

export default async function meRoutes(fastify) {
  fastify.get("/api/me", { preHandler: requirePayerAuth }, async (request, reply) => {
    const result = await pool.query(
      "SELECT id, name, email, default_payment_qr_image_url, default_payment_method_type FROM users WHERE id = $1",
      [request.payerUserId]
    );
    return reply.send(result.rows[0]);
  });

  fastify.post("/api/me/payment-qr", { preHandler: requirePayerAuth }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "MISSING_FILE", message: "No QR image uploaded" });
    const fields = file.fields ?? {};
    const parsed = paymentQrSchema.safeParse({ methodType: fields.methodType?.value });
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_BODY", message: parsed.error.message });

    const buffer = await file.toBuffer();
    const qrUrl = await saveImage(buffer, file.mimetype);
    const updated = await pool.query(
      `UPDATE users SET default_payment_qr_image_url = $1, default_payment_method_type = $2 WHERE id = $3
       RETURNING id, name, email, default_payment_qr_image_url, default_payment_method_type`,
      [qrUrl, parsed.data.methodType, request.payerUserId]
    );
    return reply.send(updated.rows[0]);
  });
}
