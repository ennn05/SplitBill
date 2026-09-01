# Receipt Splitter App — Build Plan

A web + mobile app that scans receipts (physical, online, or screenshots), lets multiple people claim which items are theirs, calculates who owes what (including proportional tax/service charge), and lets the payer share a bank/TnG QR code for collection — with an AI chatbox for natural-language bill adjustments.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Web | Next.js → deployed on Vercel |
| Mobile | React Native (Expo) — shares types/API client with web |
| Backend API + Realtime | Node.js (Fastify/Express) + Socket.io → deployed on Render |
| Database | Postgres (Supabase or Render Postgres) |
| Auth | Firebase Auth (payer only; guests get short-lived signed session tokens) |
| Receipt parsing | Multimodal LLM (Claude/GPT-4V) with strict structured JSON output |
| Chat adjustments | LLM with function-calling → structured diff, validated before applying |
| File storage | Firebase Storage or Supabase Storage (receipt images, QR images) |

---

## 2. Core Flow

1. **Payer** logs in (Firebase Auth), uploads a receipt (photo / screenshot / online order confirmation).
2. Backend sends the image to an LLM with a strict JSON schema prompt → extracts items, quantities, prices, tax, service charge, total.
3. Payer reviews and corrects the extracted list (LLM OCR is not perfect — this confirm step is mandatory, never auto-publish).
4. Payer publishes the bill → gets a shareable join link + short join code + auto-generated QR (this QR just encodes the join link, unrelated to payment).
5. **Guests join** via link/code, enter a display name — no login required. They get a short-lived JWT (`guest_session_token`) scoped to that bill.
6. Everyone sees the item list live (Socket.io room per bill) and taps to claim items. Items can be split across multiple people via `share_fraction`.
7. Tax/service charge is split **proportionally** to each participant's item subtotal share, recalculated live as claims change.
7a. Payer locks the bill manually when claiming is done (no auto-expiry). Locking is blocked if any item is not fully claimed (`SUM(share_fraction) < 1`) — the payer must resolve every leftover item first (assign it to themselves, split it evenly, or wait for guests to finish) before the lock succeeds.
8. Payer uploads their bank QR or TnG QR image and sets it as the payment method for this bill.
9. **AI chatbox**: guests can type suggestions (e.g. "split the cake 3 ways") which become a `pending` adjustment; payer approves/rejects. Payer-initiated adjustments apply immediately. All adjustments are logged for transparency.
10. Each guest sees "You owe RM X", scans the payer's QR, pays externally (app does not touch real money). Payer can manually mark participants as paid.

---

## 3. Database Schema (Postgres)

```sql
-- Registered users (payers only need accounts)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- A single bill/session
CREATE TABLE bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','locked','settled')),
  raw_receipt_image_url TEXT,
  currency TEXT NOT NULL DEFAULT 'MYR',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_charge_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_qr_image_url TEXT,
  payment_method_type TEXT CHECK (payment_method_type IN ('bank','tng')),
  join_code TEXT UNIQUE NOT NULL,
  join_link_token TEXT UNIQUE NOT NULL,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Line items extracted from the receipt
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  quantity NUMERIC(8,2) NOT NULL DEFAULT 1,
  raw_line_text TEXT,
  sort_order INT DEFAULT 0
);

-- Participants in a bill (payer + guests)
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),        -- null for guests
  guest_name TEXT,
  guest_session_token_hash TEXT UNIQUE,     -- SHA-256 of the JWT; raw token never stored, only returned to the client
  is_payer BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT now()
);

-- Who claims which item, with fractional share for split items
CREATE TABLE item_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  share_fraction NUMERIC(4,3) NOT NULL DEFAULT 1.0
    CHECK (share_fraction > 0 AND share_fraction <= 1),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, participant_id)
);

-- Audit trail + approval queue for AI chatbox adjustments
CREATE TABLE bill_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  proposed_by_participant_id UUID NOT NULL REFERENCES participants(id),
  instruction_text TEXT NOT NULL,
  structured_diff JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','applied')),
  reviewed_by_participant_id UUID REFERENCES participants(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

-- Manual payment confirmation (no real money movement in-app)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id),
  amount_owed NUMERIC(12,2) NOT NULL,
  marked_paid_by_payer BOOLEAN NOT NULL DEFAULT false,
  marked_paid_at TIMESTAMPTZ
);

CREATE INDEX idx_items_bill ON items(bill_id);
CREATE INDEX idx_participants_bill ON participants(bill_id);
CREATE INDEX idx_claims_item ON item_claims(item_id);
CREATE INDEX idx_adjustments_bill_status ON bill_adjustments(bill_id, status);
```

**Design notes:**
- `share_fraction` on `item_claims` is what makes split items (e.g. a shared appetizer) work without special-casing — an item with two claims of `0.5` each is a 50/50 split.
- `bill_adjustments.status` implements the guest-suggests/payer-approves flow: guest-proposed diffs sit at `pending`; payer-approved ones move to `approved` then `applied` once the backend mutates `item_claims` accordingly.
- Tax/service charge are stored at the bill level and split proportionally at query/calculation time based on each participant's summed `item.unit_price * quantity * share_fraction`, not stored per-participant — this keeps them always in sync as claims change.
- **Guest auth is a hashed, revocable token, not a stored raw JWT.** The client holds the signed JWT; the server only ever sees and stores `SHA-256(token)` in `guest_session_token_hash`. Every `bill:join` validates by re-hashing the incoming token and comparing — a DB leak alone can't be used to impersonate a guest, and a payer can revoke a guest by nulling their hash.
- **Item-claim over-allocation must be enforced at the application layer**, not the DB: on every `item:claim`, the backend must check that `SUM(share_fraction)` across all claims on that item (including the new one) does not exceed `1`, rejecting the write with an `error` event otherwise. Postgres CHECK constraints can't express a cross-row aggregate, so this is a required guard in the claim-handling code path, not optional.

---

## 4. Socket.io Event Contract

Each bill has its own room: `bill:{bill_id}`. Guests authenticate the socket connection with their `guest_session_token`; the payer authenticates with their Firebase ID token.

### Client → Server

| Event | Payload | Notes |
|---|---|---|
| `bill:join` | `{ billId, token }` | Joins the socket room; server validates token, returns current bill state |
| `item:claim` | `{ itemId, shareFraction }` | Participant claims (or updates their share of) an item |
| `item:unclaim` | `{ itemId }` | Removes participant's claim on an item |
| `chat:propose_adjustment` | `{ instructionText }` | Sent to backend, which calls the LLM, stores a `bill_adjustments` row, and broadcasts it |
| `adjustment:review` | `{ adjustmentId, decision: 'approved'|'rejected' }` | Payer-only; applies or discards a pending diff |
| `payment:mark_paid` | `{ participantId }` | Payer-only |
| `bill:lock` | `{}` | Payer-only; freezes further claims. Rejected with `error` if any item is still under-claimed (`SUM(share_fraction) < 1`) — server responds with the list of unresolved item IDs so the UI can prompt the payer to resolve them |

### Server → Client (broadcast to room)

| Event | Payload | Notes |
|---|---|---|
| `bill:state` | full bill snapshot (items, claims, participants, totals) | Sent on join, and as a periodic reconciliation snapshot |
| `item:claimed` | `{ itemId, participantId, shareFraction }` | Incremental update |
| `item:unclaimed` | `{ itemId, participantId }` | Incremental update |
| `participant:joined` | `{ participant }` | New guest joined |
| `totals:updated` | `{ perParticipantTotals: [...] }` | Recomputed after any claim/adjustment change |
| `adjustment:proposed` | `{ adjustment }` | Notifies payer a new suggestion needs review |
| `adjustment:applied` | `{ adjustment, updatedState }` | Broadcasts the resulting change to everyone |
| `adjustment:rejected` | `{ adjustmentId }` | |
| `payment:updated` | `{ participantId, markedPaid }` | |
| `bill:locked` | `{}` | |
| `error` | `{ code, message }` | Auth failure, invalid claim, stale token, etc. |

**Reconciliation rule:** on every mutating event, the server recomputes `totals:updated` server-side from the DB (never trusts a client-calculated total) and broadcasts it — this prevents drift or spoofed totals from a malicious client.

---

## 5. Phased Roadmap

**Phase 1 — Core web app** ✅ done, deployed, and validated end-to-end on real infra (Vercel + Render + Supabase + Firebase + Gemini)
- Firebase Auth (payer login: Google + email/password) + Next.js scaffold on Vercel
- Backend on Render: Postgres schema above, REST endpoints for bills/items/participants/claims
- Receipt upload → LLM extraction → editable review screen before publishing (rate-limited per user — each upload is a paid LLM call, so this needs abuse protection from day one, not deferred to Phase 4)
- Join-by-link/code flow for guests (no login, session token)
- Socket.io live claiming
- Proportional tax/service-charge calculation, live running total per person
- Payer uploads QR image (bank/TnG), guests see "you owe RM X" — plus a saved default QR in Settings, reused across bills with a per-bill override
- Manual "mark as paid" by payer

**Phase 2 — Mobile app** *(not started — deferred by choice; web (Phase 3/4) prioritized first)*
- React Native (Expo) client reusing the same API/socket layer
- Native camera capture for receipts
- Push notifications (new claim, payment marked, someone joined)

**Phase 3 — AI chatbox** ✅ done, verified live against real Gemini/Postgres/Socket.io
- Structured diff schema + validator (must reconcile totals, no orphaned claims)
- Payer-initiated adjustments first (no approval flow needed)
- Guest-suggested adjustments with approve/reject UI
- Adjustment history log visible to all participants

**Phase 4 — Polish**
- ✅ Bill history/dashboard for the payer
- ⬛ Real DuitNow QR generation instead of image upload — **skipped by choice**: needs a registered DuitNow merchant ID (real bank/business integration), not buildable without that credential. Image upload is the permanent solution.
- ✅ Rate-limiting/abuse protection on guest join codes; link/code expiry (short codes expire 30 min after publish; join link never expires on its own)

**Also added along the way (not in the original plan):**
- Dark mode following system color-scheme preference
- Settings page for a reusable default payment QR

---

## 6. Decisions (resolved)

- **Session expiry:** manual lock only. No auto-expiry timer in v1 — the payer taps "lock" when claiming is done. Simplest for v1; revisit if abandoned bills become an issue.
- **Unclaimed items / rounding remainders:** flagged for manual resolution, not silently absorbed. `bill:lock` is rejected while any item has `SUM(share_fraction) < 1`; the payer must explicitly resolve each one (assign to self, split evenly, or wait) before the bill can be locked and settled. See §2 step 7a and the `bill:lock` contract in §4.
- **Join code security:** short codes are guessable; treat the join *link* (long random token) as primary, with the short code as a secondary/backup entry method that expires quickly.
- **Guest session tokens:** hashed at rest, not stored raw. See `guest_session_token_hash` in §3 and the design note below it. Enables guest revocation without weakening the JWT's self-verifying property.
- **Mobile build order:** Phase 2 (Expo) starts only after Phase 1 web is deployed and the core flow is validated live — not built in parallel, to avoid maintaining two clients against a schema that's still moving. Phase 1 is now done; Phase 3/4 web work was prioritized ahead of starting mobile.
- **Chat adjustment scope:** LLM-driven diffs only reassign item claims (§4's `set_item_claims`-shaped operations) — adding/removing items or editing tax/service charge is out of scope for chat, since that touches receipt data that should stay under the payer's direct review in the edit screen, not a natural-language mutation. Uses Gemini (`gemini-flash-lite-latest`, falling back to `gemini-flash-latest` on transient overload) for consistency with receipt extraction, both free-tier.
- **DuitNow QR:** stays on image upload permanently — generating a real DuitNow-standard QR needs a registered merchant ID (a real bank/business integration), which isn't obtainable without the user's own business credentials.
