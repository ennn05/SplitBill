import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";

let firebaseApp;
function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
  return firebaseApp;
}

/** Verifies a Firebase ID token from the payer's client. Throws if invalid/expired. */
export async function verifyFirebaseToken(idToken) {
  return getFirebaseApp().auth().verifyIdToken(idToken);
}

const GUEST_TOKEN_TTL = "12h";

/**
 * Guest session tokens are stateless JWTs: the signature alone proves validity.
 * The server never stores the raw token — only sha256(token) in
 * participants.guest_session_token_hash, purely so a payer can revoke a guest
 * (null out their hash) without needing a full token blacklist.
 */
export function signGuestToken({ billId, participantId }) {
  return jwt.sign({ billId, participantId }, process.env.GUEST_JWT_SECRET, {
    expiresIn: GUEST_TOKEN_TTL,
  });
}

export function verifyGuestToken(token) {
  return jwt.verify(token, process.env.GUEST_JWT_SECRET);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
