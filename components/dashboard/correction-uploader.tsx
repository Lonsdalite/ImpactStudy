"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createSubmission } from "@/lib/actions/homework";
import { downscaleImage } from "@/lib/image-downscale";
import {
  MAX_SUBMISSION_PAGES,
  MAX_UPLOAD_BYTES,
  SUBMISSIONS_BUCKET,
} from "@/lib/homework";
import type { SubmissionPage } from "@/lib/homework-types";

export interface UploaderStudent {
  id: string;
  name: string;
}
export interface UploaderAssignment {
  id: string;
  studentId: string;
  title: string;
}

const ACCEPT_FILES = "image/*,application/pdf";

/** One picked page, before upload. `url` is an object URL for image previews
 *  (null for PDFs, which show a filename chip instead). */
interface PickedPage {
  key: string; // dedupe + react key: name|size|lastModified
  file: File;
  url: string | null;
}

function pageKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "page";
}

export function CorrectionUploader({
  tenantId,
  students,
  openAssignments,
}: {
  tenantId: string;
  students: UploaderStudent[];
  openAssignments: UploaderAssignment[];
}) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [assignmentId, setAssignmentId] = useState("");
  const [pages, setPages] = useState<PickedPage[]>([]);
  const [phase, setPhase] = useState<"idle" | "uploading">("idle");

  // Revoke every object URL on unmount so a long correction session doesn't leak
  // blob URLs. (Per-page revocation on remove is handled in removePage.) The ref
  // is mirrored inside an effect — never assigned during render.
  const pagesRef = useRef<PickedPage[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => {
    return () => {
      for (const p of pagesRef.current) if (p.url) URL.revokeObjectURL(p.url);
    };
  }, []);

  const studentAssignments = useMemo(
    () => openAssignments.filter((a) => a.studentId === studentId),
    [openAssignments, studentId],
  );

  const busy = phase !== "idle";

  /** ADDITIVE capture (Slice C.5 item a). The old uploader did
   *  `setFiles(Array.from(e.target.files))` — a phone camera returns one photo
   *  per tap, so page 2 REPLACED page 1. Here each pick APPENDS to the growing
   *  strip, deduped by name+size+lastModified. */
  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    setPages((prev) => {
      const have = new Set(prev.map((p) => p.key));
      const next = [...prev];
      let skippedDupes = 0;
      let skippedFull = 0;
      for (const f of incoming) {
        const key = pageKey(f);
        if (have.has(key)) {
          skippedDupes += 1;
          continue;
        }
        if (next.length >= MAX_SUBMISSION_PAGES) {
          skippedFull += 1;
          continue;
        }
        have.add(key);
        next.push({
          key,
          file: f,
          url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        });
      }
      if (skippedDupes > 0)
        toast.message(
          `Skipped ${skippedDupes} page${skippedDupes > 1 ? "s" : ""} already added`,
        );
      if (skippedFull > 0)
        toast.error(`That's the max of ${MAX_SUBMISSION_PAGES} pages`);
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

  function movePage(index: number, dir: -1 | 1) {
    setPages((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  function clearPages() {
    for (const p of pages) if (p.url) URL.revokeObjectURL(p.url);
    setPages([]);
    if (cameraRef.current) cameraRef.current.value = "";
    if (filesRef.current) filesRef.current.value = "";
  }

  async function run() {
    if (!studentId) {
      toast.error("Pick a student");
      return;
    }
    if (pages.length === 0) {
      toast.error("Add at least one photo or PDF");
      return;
    }
    const oversized = pages.find((p) => p.file.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      toast.error(
        `"${oversized.file.name}" is over 10 MB — a phone photo is usually well under that.`,
      );
      return;
    }
    const supabase = createClient();
    const uploadId = crypto.randomUUID();
    const uploaded: SubmissionPage[] = [];

    setPhase("uploading");
    try {
      for (let i = 0; i < pages.length; i++) {
        // Shrink big photos before upload — cuts both storage and grading
        // tokens (Claude downscales anyway). PDFs pass through untouched.
        const f = await downscaleImage(pages[i].file);
        // `${tenantId}/${studentId}/${uploadId}/…` — segment 2 is the owning
        // student (Slice D). It's what the student storage policy matches on,
        // so a child can see the page Fatima photographed of THEIR work and
        // nothing else. Slice-C objects (no student segment) keep working:
        // the staff policy only ever reads segment 1.
        const path = `${tenantId}/${studentId}/${uploadId}/${i}-${safeName(f.name)}`;
        const { error } = await supabase.storage
          .from(SUBMISSIONS_BUCKET)
          .upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (error) {
          setPhase("idle");
          toast.error(`Upload failed: ${error.message}`);
          return;
        }
        uploaded.push({
          path,
          name: f.name,
          mime: f.type || "application/octet-stream",
        });
      }
    } catch {
      setPhase("idle");
      toast.error("Upload failed — check your connection and try again.");
      return;
    }

    const sub = await createSubmission({
      studentId,
      assignmentId: assignmentId || null,
      pages: uploaded,
    });
    setPhase("idle");
    if (!sub.ok || !sub.submissionId) {
      toast.error(sub.error ?? "Couldn't save the submission");
      return;
    }

    toast.success("Uploaded — hit “Evaluate” below to mark it.");
    clearPages();
    setAssignmentId("");
    router.refresh();
  }

  const pageCount = pages.length;

  return (
    <div className="rounded-2xl border border-brand-mist bg-white p-5">
      <h2 className="text-sm font-medium text-brand-plum">Correct a page</h2>
      <p className="mt-1 text-xs text-brand-ink/55">
        Snap each page of the student&apos;s work — add as many as you need, then
        upload. You review every mark before anything goes out. No assignment
        needed.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-brand-ink/60">
          Student
          <select
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              setAssignmentId("");
            }}
            className="mt-1 block min-h-[44px] rounded-lg border border-brand-mist bg-white px-2 py-2 text-sm text-brand-plum focus:outline-none"
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {studentAssignments.length > 0 ? (
          <label className="text-xs text-brand-ink/60">
            Assignment (optional)
            <select
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
              className="mt-1 block min-h-[44px] rounded-lg border border-brand-mist bg-white px-2 py-2 text-sm text-brand-plum focus:outline-none"
            >
              <option value="">Standalone (no assignment)</option>
              {studentAssignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {/* Hidden inputs. Camera is image-only + capture-hint so a phone opens the
          camera straight away; "Add files" allows the gallery + PDFs. Both are
          additive (each onChange appends, then resets so re-picking the same
          file still fires). */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={filesRef}
        type="file"
        accept={ACCEPT_FILES}
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy || pageCount >= MAX_SUBMISSION_PAGES}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          {pageCount === 0 ? "Take photo" : "Add page"}
        </button>
        <button
          type="button"
          onClick={() => filesRef.current?.click()}
          disabled={busy || pageCount >= MAX_SUBMISSION_PAGES}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-brand-mist px-4 py-2 text-sm font-medium text-brand-ink/70 transition-colors hover:bg-brand-plum/[0.04] disabled:opacity-50"
        >
          Add files
        </button>
      </div>

      {pageCount > 0 ? (
        <>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs font-medium text-brand-ink/60">
              {pageCount} page{pageCount > 1 ? "s" : ""} ready
            </p>
            <button
              type="button"
              onClick={clearPages}
              disabled={busy}
              className="text-xs text-brand-ink/45 hover:text-red-600 disabled:opacity-50"
            >
              Clear all
            </button>
          </div>

          {/* Thumbnail strip — scrolls horizontally on a narrow phone, but is a
              contained strip (never forces the whole page to scroll). */}
          <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
            {pages.map((p, i) => (
              <div
                key={p.key}
                className="relative shrink-0"
                style={{ width: 96 }}
              >
                <div className="flex h-28 w-24 items-center justify-center overflow-hidden rounded-lg border border-brand-mist bg-brand-cream/40">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.url}
                      alt={`Page ${i + 1}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="px-1 text-center text-[10px] leading-tight text-brand-ink/60">
                      PDF
                      <br />
                      {p.file.name.slice(-16)}
                    </span>
                  )}
                </div>
                <span className="absolute left-1 top-1 rounded-full bg-brand-plum/85 px-1.5 py-0.5 text-[10px] font-medium text-brand-cream">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removePage(p.key)}
                  disabled={busy}
                  aria-label={`Remove page ${i + 1}`}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-brand-mist bg-white text-sm text-brand-ink/60 shadow-sm hover:text-red-600 disabled:opacity-50"
                >
                  ×
                </button>
                <div className="mt-1 flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => movePage(i, -1)}
                    disabled={busy || i === 0}
                    aria-label={`Move page ${i + 1} earlier`}
                    className="text-xs text-brand-plum-mid disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => movePage(i, 1)}
                    disabled={busy || i === pages.length - 1}
                    aria-label={`Move page ${i + 1} later`}
                    className="text-xs text-brand-plum-mid disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={run}
        disabled={busy || pageCount === 0 || students.length === 0}
        className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-brand-plum px-5 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
      >
        {phase === "uploading"
          ? "Uploading…"
          : `Upload${pageCount > 1 ? ` ${pageCount} pages` : ""}`}
      </button>
    </div>
  );
}
