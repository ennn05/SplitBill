import Anthropic from "@anthropic-ai/sdk";

const RECEIPT_TOOL = {
  name: "record_receipt",
  description: "Records the structured contents of a scanned receipt.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            unit_price: { type: "number", description: "Price of a single unit, before tax/service charge" },
            quantity: { type: "number" },
            raw_line_text: { type: "string", description: "The original line of text this item was parsed from" },
          },
          required: ["name", "unit_price", "quantity"],
        },
      },
      subtotal: { type: "number" },
      tax_amount: { type: "number" },
      service_charge_amount: { type: "number" },
      total: { type: "number" },
      currency: { type: "string", description: "ISO 4217 code, e.g. MYR" },
    },
    required: ["items", "subtotal", "tax_amount", "service_charge_amount", "total"],
  },
};

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Extracts structured line items/totals from a receipt image. This is never
 * trusted as final — SplitBillplan.md section 2, step 3 requires the payer to
 * review and correct every extracted field before a bill can be published.
 */
export async function extractReceipt(imageBuffer, mimeType) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    tools: [RECEIPT_TOOL],
    tool_choice: { type: "tool", name: "record_receipt" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: imageBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Extract every line item, quantity, unit price, tax, service charge, and total from this receipt. If a field isn't present on the receipt, use 0.",
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse) throw new Error("Model did not return structured receipt data");
  return toolUse.input;
}
