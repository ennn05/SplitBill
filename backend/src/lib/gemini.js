import { GoogleGenAI } from "@google/genai";

export { Type } from "@google/genai";

let client;
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

function isTransientlyUnavailable(err) {
  return err?.status === 503 || /UNAVAILABLE|high demand/i.test(err?.message ?? "");
}

/**
 * Calls Gemini's generateContent for structured JSON output, retrying once
 * against `fallbackModel` if the primary model is transiently overloaded -
 * an observed real failure mode (Google's own "high demand" 503), not a
 * hypothetical. Any other kind of failure (bad request, deprecated model,
 * auth) is not retried and propagates as-is.
 */
export async function generateStructuredContent({ model, fallbackModel, contents, schema }) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const config = { responseMimeType: "application/json", responseSchema: schema };

  try {
    return await getClient().models.generateContent({ model, contents, config });
  } catch (err) {
    if (fallbackModel && isTransientlyUnavailable(err)) {
      return await getClient().models.generateContent({ model: fallbackModel, contents, config });
    }
    throw err;
  }
}
