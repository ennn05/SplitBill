-- SplitBill schema. See SplitBillplan.md section 3 for design notes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Registered users (payers only need accounts)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- A saved default QR the payer can reuse across bills instead of re-uploading each time.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_payment_qr_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_payment_method_type TEXT
  CHECK (default_payment_method_type IN ('bank','tng'));

-- A single bill/session
CREATE TABLE IF NOT EXISTS bills (
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

-- The short join_code is guessable (see SplitBillplan.md section 6) and expires
-- shortly after publish; the long join_link_token has no expiry of its own.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS join_code_expires_at TIMESTAMPTZ;

-- Line items extracted from the receipt
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  quantity NUMERIC(8,2) NOT NULL DEFAULT 1,
  raw_line_text TEXT,
  sort_order INT DEFAULT 0
);

-- Participants in a bill (payer + guests)
CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),        -- null for guests
  guest_name TEXT,
  guest_session_token_hash TEXT UNIQUE,     -- SHA-256 of the guest JWT; raw token is never stored
  is_payer BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT now()
);

-- Who claims which item, with fractional share for split items
CREATE TABLE IF NOT EXISTS item_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  share_fraction NUMERIC(4,3) NOT NULL DEFAULT 1.0
    CHECK (share_fraction > 0 AND share_fraction <= 1),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, participant_id)
);

-- Audit trail + approval queue for AI chatbox adjustments
CREATE TABLE IF NOT EXISTS bill_adjustments (
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
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id),
  amount_owed NUMERIC(12,2) NOT NULL,
  marked_paid_by_payer BOOLEAN NOT NULL DEFAULT false,
  marked_paid_at TIMESTAMPTZ,
  UNIQUE (bill_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_items_bill ON items(bill_id);
CREATE INDEX IF NOT EXISTS idx_participants_bill ON participants(bill_id);
CREATE INDEX IF NOT EXISTS idx_claims_item ON item_claims(item_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_bill_status ON bill_adjustments(bill_id, status);
