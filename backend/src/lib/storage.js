import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

/**
 * Local-disk storage adapter, served statically by the backend (see server.js).
 * Swap this for a Supabase/Firebase Storage adapter with the same
 * `saveImage(buffer, mimeType) -> url` signature before deploying to Render,
 * since local disk doesn't survive a redeploy there.
 */
export async function saveImage(buffer, mimeType) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const filename = `${nanoid(16)}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  const base = process.env.PUBLIC_BACKEND_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return `${base}/uploads/${filename}`;
}

export { UPLOAD_DIR };
