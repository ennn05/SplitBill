"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./api";
import type { Adjustment, BillState, Item, ItemClaim, ParticipantTotal } from "./types";

interface SocketError {
  code: string;
  message: string;
}

export type LiveBillState = BillState & { yourParticipantId: string };

/**
 * Drives the live bill view for both payer and guest clients over the
 * Socket.io contract in SplitBillplan.md section 4. `token` is either a
 * Firebase ID token (payer) or a guest JWT - the server tells them apart.
 */
export function useBillSocket(billId: string | null, token: string | null) {
  const [state, setState] = useState<LiveBillState | null>(null);
  const [error, setError] = useState<SocketError | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!billId || !token) return;

    const socket = io(API_BASE, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("bill:join", { billId, token });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("bill:state", (fullState: LiveBillState) => setState(fullState));

    socket.on(
      "item:claimed",
      (payload: { itemId: string; participantId: string; shareFraction: number }) => {
        setState((prev) => {
          if (!prev) return prev;
          const claims = prev.claims.filter(
            (c) => !(c.item_id === payload.itemId && c.participant_id === payload.participantId)
          );
          const newClaim: ItemClaim = {
            id: `${payload.itemId}:${payload.participantId}`,
            item_id: payload.itemId,
            participant_id: payload.participantId,
            share_fraction: String(payload.shareFraction),
          };
          return { ...prev, claims: [...claims, newClaim] };
        });
      }
    );

    socket.on("item:unclaimed", (payload: { itemId: string; participantId: string }) => {
      setState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          claims: prev.claims.filter(
            (c) => !(c.item_id === payload.itemId && c.participant_id === payload.participantId)
          ),
        };
      });
    });

    socket.on("participant:joined", (payload: { participant: BillState["participants"][number] }) => {
      setState((prev) => {
        if (!prev) return prev;
        if (prev.participants.some((p) => p.id === payload.participant.id)) return prev;
        return { ...prev, participants: [...prev.participants, payload.participant] };
      });
    });

    socket.on("totals:updated", (payload: { perParticipantTotals: ParticipantTotal[] }) => {
      setState((prev) =>
        prev ? { ...prev, totals: { ...prev.totals, perParticipant: payload.perParticipantTotals } } : prev
      );
    });

    socket.on("payment:updated", (payload: { participantId: string; markedPaid: boolean }) => {
      setState((prev) => {
        if (!prev) return prev;
        const existing = prev.payments.find((p) => p.participant_id === payload.participantId);
        const updated = existing
          ? { ...existing, marked_paid_by_payer: payload.markedPaid }
          : {
              id: payload.participantId,
              bill_id: prev.bill.id,
              participant_id: payload.participantId,
              amount_owed: "0",
              marked_paid_by_payer: payload.markedPaid,
              marked_paid_at: new Date().toISOString(),
            };
        return {
          ...prev,
          payments: [...prev.payments.filter((p) => p.participant_id !== payload.participantId), updated],
        };
      });
    });

    socket.on("bill:locked", () => {
      setState((prev) => (prev ? { ...prev, bill: { ...prev.bill, status: "locked" } } : prev));
    });

    socket.on("adjustment:proposed", (payload: { adjustment: Adjustment }) => {
      setState((prev) => (prev ? { ...prev, adjustments: [...prev.adjustments, payload.adjustment] } : prev));
    });

    socket.on("adjustment:rejected", (payload: { adjustmentId: string }) => {
      setState((prev) =>
        prev
          ? {
              ...prev,
              adjustments: prev.adjustments.map((a) =>
                a.id === payload.adjustmentId ? { ...a, status: "rejected" } : a
              ),
            }
          : prev
      );
    });

    type AdjustmentResultPayload = {
      adjustment: Adjustment;
      updatedState: { items: Item[]; claims: ItemClaim[]; totals: BillState["totals"] };
    };
    const applyAdjustmentResult = (payload: AdjustmentResultPayload) => {
      setState((prev) => {
        if (!prev) return prev;
        const adjustments = prev.adjustments.some((a) => a.id === payload.adjustment.id)
          ? prev.adjustments.map((a) => (a.id === payload.adjustment.id ? payload.adjustment : a))
          : [...prev.adjustments, payload.adjustment];
        return {
          ...prev,
          adjustments,
          items: payload.updatedState.items,
          claims: payload.updatedState.claims,
          totals: payload.updatedState.totals,
        };
      });
    };
    // Applying and reverting both replace items/claims/totals wholesale and
    // upsert the same adjustment row - only the row's status/reverted_at differ.
    socket.on("adjustment:applied", applyAdjustmentResult);
    socket.on("adjustment:reverted", applyAdjustmentResult);

    socket.on("error", (payload: SocketError) => setError(payload));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [billId, token]);

  const claimItem = useCallback((itemId: string, shareFraction: number) => {
    socketRef.current?.emit("item:claim", { itemId, shareFraction });
  }, []);

  const unclaimItem = useCallback((itemId: string) => {
    socketRef.current?.emit("item:unclaim", { itemId });
  }, []);

  const lockBill = useCallback(() => {
    socketRef.current?.emit("bill:lock", {});
  }, []);

  const markPaid = useCallback((participantId: string) => {
    socketRef.current?.emit("payment:mark_paid", { participantId });
  }, []);

  const proposeAdjustment = useCallback((instructionText: string) => {
    socketRef.current?.emit("chat:propose_adjustment", { instructionText });
  }, []);

  const reviewAdjustment = useCallback((adjustmentId: string, decision: "approved" | "rejected") => {
    socketRef.current?.emit("adjustment:review", { adjustmentId, decision });
  }, []);

  const revertAdjustment = useCallback((adjustmentId: string) => {
    socketRef.current?.emit("adjustment:revert", { adjustmentId });
  }, []);

  return {
    state,
    error,
    connected,
    claimItem,
    unclaimItem,
    lockBill,
    markPaid,
    proposeAdjustment,
    reviewAdjustment,
    revertAdjustment,
  };
}
