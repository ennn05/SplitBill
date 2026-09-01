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

/** Thrown when Gemini remains overloaded after every retry/fallback attempt - lets
 * callers show a clean "try again" message instead of the raw provider error JSON. */
export class ModelOverloadedError extends Error {
  constructor() {
    super("The AI assistant is temporarily busy. Please try again in a moment.");
    this.name = "ModelOverloadedError";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryModel(model, contents, config) {
  return getClient().models.generateContent({ model, contents, config });
}

/**
 * Calls Gemini's generateContent for structured JSON output. On a transient
 * overload (Google's own "high demand" 503 - an observed real failure mode,
 * not hypothetical), retries the primary model once after a short delay,
 * then falls back to `fallbackModel` (also retried once) before giving up
 * with a clean ModelOverloadedError. Any other kind of failure (bad request,
 * deprecated model, auth) is not retried and propagates as-is.
 */
export async function generateStructuredContent({ model, fallbackModel, contents, schema }) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const config = { responseMimeType: "application/json", responseSchema: schema };

  const attempts = fallbackModel ? [model, model, fallbackModel, fallbackModel] : [model, model];
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await tryModel(attempts[i], contents, config);
    } catch (err) {
      if (!isTransientlyUnavailable(err)) throw err;
      if (i < attempts.length - 1) await sleep(750);
    }
  }
  throw new ModelOverloadedError();
}
