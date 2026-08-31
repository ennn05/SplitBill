import { z } from "zod";
import { pool } from "../db/pool.js";
import { signGuestToken, hashToken } from "../lib/auth.js";

const joinBodySchema = z.object({ guestName: z.string().min(1).max(80) });

async function findBillByCodeOrToken(codeOrToken) {
  const result = await pool.query(
    "SELECT * FROM bills WHERE join_code = $1 OR join_link_token = $1",
    [codeOrToken]
  );
  return result.rows[0] ?? null;
}

export default async function joinRoutes(fastify) {
  // Public preview so a guest can confirm they're joining the right bill before entering their name.
  fastify.get("/api/join/:codeOrToken", async (request, reply) => {
    const bill = await findBillByCodeOrToken(request.params.codeOrToken);
    if (!bill) return reply.code(404).send({ code: "NOT_FOUND", message: "Invalid join code or link" });
    return reply.send({ billId: bill.id, title: bill.title, status: bill.status, currency: bill.currency });
  });

  fastify.post("/api/join/:codeOrToken", async (request, reply) => {
    const parsed = joinBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_BODY", message: parsed.error.message });

    const bill = await findBillByCodeOrToken(request.params.codeOrToken);
    if (!bill) return reply.code(404).send({ code: "NOT_FOUND", message: "Invalid join code or link" });
    if (bill.status !== "open") {
      return reply.code(409).send({ code: "BILL_NOT_OPEN", message: "This bill isn't accepting new participants" });
    }

    const participant = await pool.query(
      `INSERT INTO participants (bill_id, guest_name, is_payer) VALUES ($1, $2, false) RETURNING id`,
      [bill.id, parsed.data.guestName]
    );
    const participantId = participant.rows[0].id;

    const guestToken = signGuestToken({ billId: bill.id, participantId });
    await pool.query("UPDATE participants SET guest_session_token_hash = $1 WHERE id = $2", [
      hashToken(guestToken),
      participantId,
    ]);

    return reply.code(201).send({ billId: bill.id, participantId, guestToken });
  });
}
