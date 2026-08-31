import { verifyFirebaseToken } from "../lib/auth.js";
import { pool } from "../db/pool.js";

/**
 * Fastify preHandler: verifies the payer's Firebase ID token and attaches
 * `request.payerUserId`, auto-provisioning a `users` row on first sign-in
 * (payers never have a separate signup step - see SplitBillplan.md section 2).
 */
export async function requirePayerAuth(request, reply) {
  const authHeader = request.headers.authorization ?? "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return reply.code(401).send({ code: "UNAUTHENTICATED", message: "Missing Authorization header" });
  }

  let decoded;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch {
    return reply.code(401).send({ code: "INVALID_TOKEN", message: "Firebase token invalid or expired" });
  }

  const existing = await pool.query("SELECT id FROM users WHERE firebase_uid = $1", [decoded.uid]);
  if (existing.rows.length > 0) {
    request.payerUserId = existing.rows[0].id;
    return;
  }

  const inserted = await pool.query(
    `INSERT INTO users (firebase_uid, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [decoded.uid, decoded.name ?? "Payer", decoded.email ?? null]
  );
  request.payerUserId = inserted.rows[0].id;
}

/** Verifies the requesting payer owns the given bill; call after requirePayerAuth. */
export async function requireBillOwner(request, reply) {
  const { billId } = request.params;
  const result = await pool.query("SELECT owner_user_id FROM bills WHERE id = $1", [billId]);
  if (result.rows.length === 0) {
    return reply.code(404).send({ code: "NOT_FOUND", message: "Bill not found" });
  }
  if (result.rows[0].owner_user_id !== request.payerUserId) {
    return reply.code(403).send({ code: "FORBIDDEN", message: "Not the owner of this bill" });
  }
}
