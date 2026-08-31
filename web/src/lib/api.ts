import type { Bill, BillState, ExtractedItem, ExtractedReceipt } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Request failed with ${res.status}`);
  }
  return res.json();
}

function authHeaders(idToken: string): HeadersInit {
  return { Authorization: `Bearer ${idToken}` };
}

export async function createBill(idToken: string, title?: string): Promise<Bill> {
  const res = await fetch(`${API_BASE}/api/bills`, {
    method: "POST",
    headers: { ...authHeaders(idToken), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return handle(res);
}

export async function getBill(idToken: string, billId: string): Promise<BillState> {
  const res = await fetch(`${API_BASE}/api/bills/${billId}`, { headers: authHeaders(idToken) });
  return handle(res);
}

export async function uploadReceipt(
  idToken: string,
  billId: string,
  file: File
): Promise<{ bill: Bill; items: ExtractedItem[] }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/bills/${billId}/receipt`, {
    method: "POST",
    headers: authHeaders(idToken),
    body: formData,
  });
  return handle(res);
}

export async function saveItems(
  idToken: string,
  billId: string,
  payload: { items: ExtractedItem[] } & Omit<ExtractedReceipt, "items" | "currency">
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/bills/${billId}/items`, {
    method: "PUT",
    headers: { ...authHeaders(idToken), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function publishBill(idToken: string, billId: string): Promise<Bill> {
  const res = await fetch(`${API_BASE}/api/bills/${billId}/publish`, {
    method: "POST",
    headers: authHeaders(idToken),
  });
  return handle(res);
}

export async function uploadPaymentQr(
  idToken: string,
  billId: string,
  file: File,
  methodType: "bank" | "tng"
): Promise<Bill> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("methodType", methodType);
  const res = await fetch(`${API_BASE}/api/bills/${billId}/payment-qr`, {
    method: "POST",
    headers: authHeaders(idToken),
    body: formData,
  });
  return handle(res);
}

export async function getJoinPreview(
  codeOrToken: string
): Promise<{ billId: string; title: string | null; status: string; currency: string }> {
  const res = await fetch(`${API_BASE}/api/join/${codeOrToken}`);
  return handle(res);
}

export async function joinBill(
  codeOrToken: string,
  guestName: string
): Promise<{ billId: string; participantId: string; guestToken: string }> {
  const res = await fetch(`${API_BASE}/api/join/${codeOrToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName }),
  });
  return handle(res);
}

export { API_BASE };
