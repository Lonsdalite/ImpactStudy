import "server-only";

import { createClient } from "@/lib/supabase/server";
import { WORKSHEETS_BUCKET, SUBMISSIONS_BUCKET } from "@/lib/homework";

/**
 * Supabase Storage helpers (Slice C). Two private buckets, path convention
 * `${tenantId}/${...}` (see policies.sql §11e). All access rides the RLS
 * supabase-js server client — a tutor only ever touches their own tenant's
 * objects, and we hand out short-lived signed URLs, never public links.
 *
 * The bucket-name constants live in the client-safe lib/homework.ts (so client
 * components can build upload paths without importing this server-only module);
 * we re-export them here for server callers' convenience.
 */

export { WORKSHEETS_BUCKET, SUBMISSIONS_BUCKET };

const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30 min — long enough to view, short enough to expire

/** Sign one object for temporary viewing. Returns null if it can't be signed
 *  (missing object, RLS, or a seeded placeholder path with no real file). */
export async function signedUrl(
  bucket: string,
  path: string,
): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Sign many objects at once (best-effort; failures come back as null). */
export async function signedUrls(
  bucket: string,
  paths: string[],
): Promise<(string | null)[]> {
  if (paths.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (!data) return paths.map(() => null);
  // createSignedUrls preserves order and reports per-item errors.
  return data.map((d) => (d.error ? null : d.signedUrl));
}

/** Download an object and return it base64-encoded for an LLM image/document
 *  block. Throws if the object can't be read. */
export async function downloadBase64(
  bucket: string,
  path: string,
): Promise<{ base64: string; mime: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`Couldn't read the uploaded file (${path}).`);
  }
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = data.type || "application/octet-stream";
  return { base64: buf.toString("base64"), mime };
}
