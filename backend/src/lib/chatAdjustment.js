import { Type, generateStructuredContent } from "./gemini.js";

const DIFF_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    operations: {
      type: Type.ARRAY,
      description:
        "One entry per item whose claims should change. Omit items that don't need to change. To fully unclaim an item, include it with an empty claims array.",
      items: {
        type: Type.OBJECT,
        properties: {
          itemId: { type: Type.STRING, description: "Must be one of the item ids given in the prompt" },
          claims: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                participantId: { type: Type.STRING, description: "Must be one of the participant ids given in the prompt" },
                shareFraction: { type: Type.NUMBER, description: "Between 0 (exclusive) and 1. All claims on one item must sum to at most 1." },
              },
              required: ["participantId", "shareFraction"],
            },
          },
        },
        required: ["itemId", "claims"],
      },
    },
    summary: {
      type: Type.STRING,
      description:
        "One short sentence describing what this diff does in plain language, shown to users for review. If the instruction can't be turned into a valid diff, explain why here and return an empty operations array.",
    },
  },
  required: ["operations", "summary"],
};

/**
 * Turns a natural-language instruction ("split the cake 3 ways") into a
 * structured diff against this bill's actual items/participants. Scoped to
 * claim reassignment only (see SplitBillplan.md Phase 3) - adding/removing
 * items or changing tax/service isn't in scope, since those touch receipt
 * data that should stay under the payer's direct review, not chat-driven.
 * The model only ever sees ids it was given; callers still must validate the
 * result before applying it (see lib/applyAdjustment.js) - this function
 * produces a proposal, never a trusted mutation.
 */
export async function parseAdjustmentInstruction(instructionText, { items, participants, requestingParticipantId }) {
  const itemsContext = items.map((i) => ({
    id: i.id,
    name: i.name,
    unitPrice: Number(i.unit_price),
    quantity: Number(i.quantity),
  }));
  const participantsContext = participants.map((p) => ({
    id: p.id,
    name: p.is_payer ? `${p.guest_name ?? "Payer"} (payer)` : p.guest_name ?? "Guest",
  }));

  const response = await generateStructuredContent({
    model: "gemini-flash-lite-latest",
    fallbackModel: "gemini-flash-latest",
    schema: DIFF_SCHEMA,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You are adjusting item claims on a shared restaurant bill based on a participant's request.",
              `Items on this bill: ${JSON.stringify(itemsContext)}`,
              `Participants on this bill: ${JSON.stringify(participantsContext)}`,
              // Without this, "me"/"my"/"I" in the request has no referent and the model
              // has been observed guessing wrong (confirmed live: "give me the coke" from
              // a guest was once assigned to the payer instead).
              `The id of the participant making this request is: ${requestingParticipantId}. Resolve "me"/"my"/"I" in the request to this id.`,
              `Request: "${instructionText}"`,
              "Produce a diff that implements this request using only the item and participant ids given above.",
            ].join("\n\n"),
          },
        ],
      },
    ],
  });

  if (!response.text) throw new Error("Model did not return a structured diff");
  return JSON.parse(response.text);
}
