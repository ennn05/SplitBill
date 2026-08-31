interface GuestSession {
  participantId: string;
  guestToken: string;
}

const keyFor = (billId: string) => `splitbill:guest:${billId}`;

export function storeGuestSession(billId: string, session: GuestSession) {
  sessionStorage.setItem(keyFor(billId), JSON.stringify(session));
}

export function getGuestSession(billId: string): GuestSession | null {
  const raw = sessionStorage.getItem(keyFor(billId));
  return raw ? JSON.parse(raw) : null;
}
