/**
 * Client-side image downscaling (Slice C). Browser-only (uses canvas) — no
 * "server-only", imported by the correction uploader before it sends pages to
 * Storage + the grading model.
 *
 * WHY: Claude downscales images server-side anyway (Sonnet 5 caps at a ~2576px
 * long edge / 4784 visual tokens). A raw 12MP phone photo therefore costs ~3x
 * the visual tokens of the same page at ~1600–2000px, for no legibility gain.
 * Shrinking before upload cuts the token bill AND the bytes we store — while
 * staying well within a resolution that keeps pencil working legible.
 *
 * Non-images (PDFs) pass straight through untouched. Any failure (unsupported
 * codec, HEIC a browser can't decode, etc.) falls back to the original file so
 * an upload never silently breaks.
 */

// Target long edge in px. 2000 keeps faint handwriting legible while landing
// near ~2–3k visual tokens on Sonnet 5's high-resolution tier.
const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 0.82;

export async function downscaleImage(
  file: File,
  maxLongEdge = MAX_LONG_EDGE,
  quality = JPEG_QUALITY,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (typeof document === "undefined") return file;

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    const scale = Math.min(1, maxLongEdge / longEdge);
    if (scale >= 1) {
      bitmap.close?.();
      return file; // already small enough — don't re-encode (avoids extra artifacts)
    }
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob || blob.size >= file.size) return file; // no win — keep the original

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
