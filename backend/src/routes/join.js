import { z } from "zod";
import { pool } from "../db/pool.js";
import { signGuestToken, hashToken } from "../lib/auth.js";

const joinBodySchema = z.object({ guestName: z.string().min(1).max(80) });

// The long join_link_token never expires on its own; the short join_code is
// guessable and expires shortly after publish (see schema.sql). Matching via
// the token always succeeds regardless of that expiry - only a request that
// arrives *as the short code* can be rejected as expired.
async function findBillByCodeOrToken(codeOrToken) {
  const result = await pool.query(
    `SELECT *, (join_code = $1 AND join_code_expires_at IS NOT NULL AND join_code_expires_at <= now()) AS code_expired
     FROM bills WHERE join_code = $1 OR join_link_token = $1`,
    [codeOrToken]
  );
  return result.rows[0] ?? null;
}

export default async function joinRoutes(fastify) {
  // Public preview so a guest can confirm they're joining the right bill before entering their name.
  // Rate-limited per IP - the 6-char join_code space is small enough to be
  // brute-forceable without this (see SplitBillplan.md section 6).
  fastify.get(
    "/api/join/:codeOrToken",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const bill = await findBillByCodeOrToken(request.params.codeOrToken);
      if (!bill) return reply.code(404).send({ code: "NOT_FOUND", message: "Invalid join code or link" });
      if (bill.code_expired) {
        return reply
          .code(410)
          .send({ code: "CODE_EXPIRED", message: "This backup code has expired - ask for the join link instead" });
      }
      return reply.send({ billId: bill.id, title: bill.title, status: bill.status, currency: bill.currency });
    }
  );

  fastify.post(
    "/api/join/:codeOrToken",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = joinBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "INVALID_BODY", message: parsed.error.message });

      const bill = await findBillByCodeOrToken(request.params.codeOrToken);
      if (!bill) return reply.code(404).send({ code: "NOT_FOUND", message: "Invalid join code or link" });
      if (bill.code_expired) {
        return reply
          .code(410)
          .send({ code: "CODE_EXPIRED", message: "This backup code has expired - ask for the join link instead" });
      }
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
    }
  );
}
