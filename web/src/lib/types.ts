export type BillStatus = "draft" | "open" | "locked" | "settled";

export interface Bill {
  id: string;
  owner_user_id: string;
  title: string | null;
  status: BillStatus;
  raw_receipt_image_url: string | null;
  currency: string;
  subtotal: string;
  tax_amount: string;
  service_charge_amount: string;
  total: string;
  payment_qr_image_url: string | null;
  payment_method_type: "bank" | "tng" | null;
  join_code: string;
  join_link_token: string;
  locked_at: string | null;
  created_at: string;
}

export interface Item {
  id: string;
  bill_id: string;
  name: string;
  unit_price: string;
  quantity: string;
  raw_line_text: string | null;
  sort_order: number;
}

export interface Participant {
  id: string;
  bill_id: string;
  user_id: string | null;
  guest_name: string | null;
  is_payer: boolean;
  joined_at: string;
}

export interface ItemClaim {
  id: string;
  item_id: string;
  participant_id: string;
  share_fraction: string;
}

export interface ParticipantTotal {
  participantId: string;
  subtotal: number;
  taxAndServiceShare: number;
  total: number;
}

export type AdjustmentStatus = "pending" | "approved" | "rejected" | "applied";

export interface Adjustment {
  id: string;
  bill_id: string;
  proposed_by_participant_id: string;
  instruction_text: string;
  structured_diff: { operations: unknown[]; summary: string };
  status: AdjustmentStatus;
  reviewed_by_participant_id: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface Payment {
  id: string;
  bill_id: string;
  participant_id: string;
  amount_owed: string;
  marked_paid_by_payer: boolean;
  marked_paid_at: string | null;
}

export interface DefaultPaymentQr {
  url: string;
  methodType: "bank" | "tng";
}

export interface BillState {
  bill: Bill;
  items: Item[];
  participants: Participant[];
  claims: ItemClaim[];
  payments: Payment[];
  adjustments: Adjustment[];
  totals: { unresolvedItemIds: string[]; perParticipant: ParticipantTotal[] };
  payerDefaultPaymentQr: DefaultPaymentQr | null;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string | null;
  default_payment_qr_image_url: string | null;
  default_payment_method_type: "bank" | "tng" | null;
}

export interface ExtractedItem {
  name: string;
  unit_price: number;
  quantity: number;
  raw_line_text?: string;
}

export interface ExtractedReceipt {
  items: ExtractedItem[];
  subtotal: number;
  tax_amount: number;
  service_charge_amount: number;
  total: number;
  currency?: string;
}
