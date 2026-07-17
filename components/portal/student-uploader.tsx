"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  createStudentSubmission,
  undoStudentSubmission,
} from "@/lib/actions/portal";
import { downscaleImage } from "@/lib/image-downscale";
import {
  MAX_SUBMISSION_PAGES,
  MAX_UPLOAD_BYTES,
  SUBMISSIONS_BUCKET,
} from "@/lib/homework";
import { Button } from "@/components/ui/button";
import type { SubmissionPage } from "@/lib/homework-types";

/**
 * "Upload your work" (Slice D — doc 26 §2D).
 *
 * The student half of C's already-polymorphic uploader: same direct-to-Storage
 * path, same client-side downscale, landing as a submission with
 * uploader_role='student'. The uploads come from the student account — a parent
 * may be holding the phone for a young child, which is exactly why there's no
 * separate parent-upload UI to build.
 *
 * Simpler than the tutor's uploader on purpose. She picks a student, an
 * assignment, a correction preset; a child taps "Take a photo" and taps "Hand it
 * in". Every choice she has to make is one this screen already knows.
 */

const ACCEPT_FILES = "image/*,application/pdf";

interface PickedPage {
  key: string;
  file: File;
  url: string | null; // object URL for image previews; null for PDFs
}

function pageKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "page";
}

export function StudentUploader({
  assignmentId,
  tenantId,
  studentId,
  hasSubmission,
}: {
  assignmentId: string;
  tenantId: string;
  studentId: string;
  hasSubmission: boolean;
}) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PickedPage[]>([]);
  const [busy, setBusy] = useState(false);

  // Additive, like C.5 item (a): picking again APPENDS. A worksheet is often
  // several pages and the camera returns one at a time — replacing the previous
  // shot was the bug C.5 fixed on the tutor side, and it would bite harder here.
  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setPages((prev) => {
      const next = [...prev];
      const have = new Set(prev.map((p) => p.key));
      let full = 0;
      let dupes = 0;
      for (const f of Array.from(list)) {
        const key = pageKey(f);
        if (have.has(key)) {
          dupes += 1;
          continue;
        }
        if (next.length >= MAX_SUBMISSION_PAGES) {
          full += 1;
          continue;
        }
        have.add(key);
        next.push({
          key,
          file: f,
          url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        });
      }
      if (dupes > 0) toast.message(`Skipped ${dupes} photo${dupes > 1 ? "s" : ""} you'd already added`);
      if (full > 0) toast.error(`That's the most you can add at once (${MAX_SUBMISSION_PAGES})`);
      return next;
    });
  }

  function removePage(key: string) {
    setPages((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.key !== key);
    });
  }

  function clearPages() {
    for (const p of pages) if (p.url) URL.revokeObjectURL(p.url);
    setPages([]);
    if (cameraRef.current) cameraRef.current.value = "";
    if (filesRef.current) filesRef.current.value = "";
  }

  async function handIn() {
    if (pages.length === 0) {
      toast.error("Add a photo of your work first");
      return;
    }
    const oversized = pages.find((p) => p.file.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      toast.error(`"${oversized.file.name}" is too big. Try taking the photo again.`);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const uploadId = crypto.randomUUID();
    const uploaded: SubmissionPage[] = [];

    try {
      for (let i = 0; i < pages.length; i++) {
        const f = await downscaleImage(pages[i].file);
        // Segment 2 is the student — the path predicate the student storage
        // policy matches (policies.sql §11e). RLS refuses any other folder.
        const path = `${tenantId}/${studentId}/${uploadId}/${i}-${safeName(f.name)}`;
        const { error } = await supabase.storage
          .from(SUBMISSIONS_BUCKET)
          .upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (error) {
          setBusy(false);
          toast.error("That didn't upload. Check your internet and try again.");
          return;
        }
        uploaded.push({
          path,
          name: f.name,
          mime: f.type || "application/octet-stream",
        });
      }
    } catch {
      setBusy(false);
      toast.error("That didn't upload. Check your internet and try again.");
      return;
    }

    const res = await createStudentSubmission({ assignmentId, pages: uploaded });
    setBusy(false);
    if (!res.ok || !res.submissionId) {
      toast.error(res.error ?? "Couldn't hand that in.");
      return;
    }

    clearPages();
    // Toast-with-undo, the standing UX bar — not a confirm dialog in front of
    // the action. The undo only works until Fatima starts marking; RLS says so
    // too, and the action returns her name for it if she has.
    const submissionId = res.submissionId;
    toast.success("Handed in. Your tutor will mark it.", {
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await undoStudentSubmission(submissionId);
          if (!undo.ok) {
            toast.error(undo.error ?? "Couldn't undo that.");
            return;
          }
          toast.message("Taken back. Hand it in again when you're ready.");
          router.refresh();
        },
      },
    });
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-brand-mist bg-white p-5">
      <h2 className="text-sm font-medium text-brand-plum">
        {hasSubmission ? "Hand in more work" : "Hand in your work"}
      </h2>
      <p className="mt-1 text-xs text-brand-ink/55">
        Take a photo of each page. Make sure your writing is easy to read.
      </p>

      {/* capture="environment" opens the rear camera straight away on a phone —
          the common case is a child photographing the page in front of them. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <input
        ref={filesRef}
        type="file"
        accept={ACCEPT_FILES}
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          Take a photo
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={busy}
          onClick={() => filesRef.current?.click()}
        >
          Choose a file
        </Button>
      </div>

      {pages.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {pages.map((p) => (
              <div key={p.key} className="relative">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.url}
                    alt=""
                    className="h-24 w-24 rounded-lg border border-brand-mist object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-brand-mist bg-brand-cream/40 p-2 text-center text-[10px] leading-tight text-brand-ink/60">
                    {p.file.name}
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${p.file.name}`}
                  onClick={() => removePage(p.key)}
                  disabled={busy}
                  className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-brand-mist bg-white text-sm leading-none text-brand-ink/70 shadow-sm"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              type="button"
              className="min-h-11"
              disabled={busy}
              onClick={handIn}
            >
              {busy
                ? "Sending…"
                : `Hand in ${pages.length} page${pages.length === 1 ? "" : "s"}`}
            </Button>
            <button
              type="button"
              onClick={clearPages}
              disabled={busy}
              className="min-h-11 px-1 text-sm text-brand-ink/55 underline-offset-4 hover:underline"
            >
              Start again
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
