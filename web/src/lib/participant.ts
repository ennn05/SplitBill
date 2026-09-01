import type { Participant } from "./types";

export function participantLabel(p: Participant): string {
  const name = p.display_name ?? (p.is_payer ? "Payer" : "Guest");
  return p.is_payer ? `${name} (payer)` : name;
}
