import { customAlphabet, nanoid } from "nanoid";

// Short code: human-typeable backup entry method (secondary to the join link, per SplitBillplan.md section 6).
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid transcription errors
const generateShortCode = customAlphabet(alphabet, 6);

export function generateJoinCode() {
  return generateShortCode();
}

// Join link token: long random string, the primary/authoritative way to join a bill.
export function generateJoinLinkToken() {
  return nanoid(32);
}
