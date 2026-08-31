import { GoogleGenAI, Type } from "@google/genai";

const RECEIPT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          unit_price: { type: Type.NUMBER, description: "Price of a single unit, before tax/service charge" },
          quantity: { type: Type.NUMBER },
          raw_line_text: { type: Type.STRING, description: "The original line of text this item was parsed from" },
        },
        required: ["name", "unit_price", "quantity"],
      },
    },
    subtotal: { type: Type.NUMBER },
    tax_amount: { type: Type.NUMBER },
    service_charge_amount: { type: Type.NUMBER },
    total: { type: Type.NUMBER },
    currency: { type: Type.STRING, description: "ISO 4217 code, e.g. MYR" },
  },
  required: ["items", "subtotal", "tax_amount", "service_charge_amount", "total"],
};

let client;
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/**
 * Extracts structured line items/totals from a receipt image using Gemini's
 * free tier (no card required - see README). This is never trusted as final -
 * SplitBillplan.md section 2, step 3 requires the payer to review and correct
 * every extracted field before a bill can be published.
 */
export async function extractReceipt(imageBuffer, mimeType) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const response = await getClient().models.generateContent({
    // An alias that always tracks Google's current stable Flash model, rather than a
    // pinned version - pinned versions get deprecated for new API keys (confirmed
    // live: gemini-2.5-flash already returns 404 "no longer available to new users").
    model: "gemini-flash-latest",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: imageBuffer.toString("base64") } },
          {
            text: "Extract every line item, quantity, unit price, tax, service charge, and total from this receipt. If a field isn't present on the receipt, use 0.",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RECEIPT_SCHEMA,
    },
  });

  if (!response.text) throw new Error("Model did not return structured receipt data");
  return JSON.parse(response.text);
}
