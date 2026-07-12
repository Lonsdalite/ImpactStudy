"use client";

import { useMemo, useRef, useState } from "react";
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

const ACCEPT = "image/*,application/pdf";

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [assignmentId, setAssignmentId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<"idle" | "uploading">("idle");

  const studentAssignments = useMemo(
    () => openAssignments.filter((a) => a.studentId === studentId),
    [openAssignments, studentId],
  );

  const busy = phase !== "idle";

  async function run() {
    if (!studentId) {
      toast.error("Pick a student");
      return;
    }
    if (files.length === 0) {
      toast.error("Add at least one photo or PDF");
      return;
    }
    if (files.length > MAX_SUBMISSION_PAGES) {
      toast.error(`Up to ${MAX_SUBMISSION_PAGES} pages at a time`);
      return;
    }
    const oversized = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      toast.error(
        `"${oversized.name}" is over 10 MB — a phone photo is usually well under that.`,
      );
      return;
    }
    const supabase = createClient();
    const uploadId = crypto.randomUUID();
    const pages: SubmissionPage[] = [];

    setPhase("uploading");
    try {
      for (let i = 0; i < files.length; i++) {
        // Shrink big photos before upload — cuts both storage and grading
        // tokens (Claude downscales anyway). PDFs pass through untouched.
        const f = await downscaleImage(files[i]);
        const path = `${tenantId}/${uploadId}/${i}-${safeName(f.name)}`;
        const { error } = await supabase.storage
          .from(SUBMISSIONS_BUCKET)
          .upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (error) {
          setPhase("idle");
          toast.error(`Upload failed: ${error.message}`);
          return;
        }
        pages.push({
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
      pages,
    });
    setPhase("idle");
    if (!sub.ok || !sub.submissionId) {
      toast.error(sub.error ?? "Couldn't save the submission");
      return;
    }

    toast.success("Uploaded — hit “Evaluate with AI” below to mark it.");
    setFiles([]);
    setAssignmentId("");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-brand-mist bg-white p-5">
      <h2 className="text-sm font-medium text-brand-plum">Correct a page</h2>
      <p className="mt-1 text-xs text-brand-ink/55">
        Snap the student&apos;s work and upload it. Then evaluate it with AI
        below, and review every mark before anything goes out. No assignment
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
            className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
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
              className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
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

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="mt-4 block w-full text-sm text-brand-ink/70 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-plum file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-cream hover:file:bg-brand-plum-mid"
      />
      {files.length > 0 ? (
        <p className="mt-2 text-xs text-brand-ink/55">
          {files.length} page{files.length > 1 ? "s" : ""} ready
        </p>
      ) : null}

      <button
        type="button"
        onClick={run}
        disabled={busy || students.length === 0}
        className="mt-4 rounded-lg bg-brand-plum px-5 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
      >
        {phase === "uploading" ? "Uploading…" : "Upload"}
      </button>
    </div>
  );
}
