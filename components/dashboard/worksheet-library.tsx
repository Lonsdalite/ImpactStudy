"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  createAssignment,
  createWorksheet,
  setWorksheetActive,
} from "@/lib/actions/homework";
import { WORKSHEETS_BUCKET } from "@/lib/homework";

export interface LibrarySubject {
  id: string;
  name: string;
}
export interface LibraryStudent {
  id: string;
  name: string;
}
export interface WorksheetRow {
  id: string;
  title: string;
  subjectName: string | null;
  yearLevel: string | null;
  topic: string | null;
  fileName: string;
  active: boolean;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "worksheet";
}

export function WorksheetLibrary({
  tenantId,
  subjects,
  students,
  worksheets,
}: {
  tenantId: string;
  subjects: LibrarySubject[];
  students: LibraryStudent[];
  worksheets: WorksheetRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const active = worksheets.filter((w) => w.active);
  const archived = worksheets.filter((w) => !w.active);

  async function upload() {
    if (!title.trim()) {
      toast.error("Give the worksheet a title");
      return;
    }
    if (!file) {
      toast.error("Choose a file to upload");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const path = `${tenantId}/${crypto.randomUUID()}/${safeName(file.name)}`;
    const { error } = await supabase.storage
      .from(WORKSHEETS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) {
      setUploading(false);
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    const res = await createWorksheet({
      title,
      subjectId: subjectId || null,
      yearLevel: yearLevel || null,
      topic: topic || null,
      storagePath: path,
      fileName: file.name,
      fileMime: file.type || "application/octet-stream",
    });
    setUploading(false);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't save the worksheet");
      return;
    }
    toast.success("Worksheet added to your library");
    setTitle("");
    setYearLevel("");
    setTopic("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  const field =
    "mt-1 block w-full rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-plum focus:outline-none";

  return (
    <div className="flex flex-col gap-6">
      {/* Upload */}
      <div className="rounded-2xl border border-brand-mist bg-white p-5">
        <h2 className="text-sm font-medium text-brand-plum">Add a worksheet</h2>
        <p className="mt-1 text-xs text-brand-ink/55">
          Upload once, assign to any student, any year — as many times as you
          like. Tag it so you can find the next one.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-brand-ink/60">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fractions → decimals, set 3"
              className={field}
            />
          </label>
          <label className="text-xs text-brand-ink/60">
            Subject
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className={field}
            >
              <option value="">—</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-brand-ink/60">
            Year level
            <input
              value={yearLevel}
              onChange={(e) => setYearLevel(e.target.value)}
              placeholder="Y6"
              className={field}
            />
          </label>
          <label className="text-xs text-brand-ink/60">
            Topic (optional)
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ratio & proportion"
              className={field}
            />
          </label>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-4 block w-full text-sm text-brand-ink/70 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-plum file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-cream hover:file:bg-brand-plum-mid"
        />
        <button
          type="button"
          onClick={upload}
          disabled={uploading}
          className="mt-4 rounded-lg bg-brand-plum px-5 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Add to library"}
        </button>
      </div>

      {/* Library list */}
      <div>
        <h2 className="text-sm font-medium text-brand-plum">
          Library ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="mt-3 text-sm text-brand-ink/55">
            Nothing yet — add your first worksheet above.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {active.map((w) => (
              <WorksheetCard key={w.id} worksheet={w} students={students} />
            ))}
          </ul>
        )}

        {archived.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-brand-plum-mid">
              {archived.length} archived
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {archived.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-xl border border-brand-mist bg-white px-4 py-3"
                >
                  <span className="text-sm text-brand-ink/60">{w.title}</span>
                  <RestoreButton id={w.id} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function tagLine(w: WorksheetRow): string {
  return [w.subjectName, w.yearLevel, w.topic].filter(Boolean).join(" · ") || "Untagged";
}

function WorksheetCard({
  worksheet,
  students,
}: {
  worksheet: WorksheetRow;
  students: LibraryStudent[];
}) {
  const router = useRouter();
  const [assignTo, setAssignTo] = useState("");
  const [isPending, startTransition] = useTransition();

  function assign() {
    if (!assignTo) {
      toast.error("Pick a student");
      return;
    }
    startTransition(async () => {
      const res = await createAssignment({
        studentId: assignTo,
        worksheetId: worksheet.id,
      });
      if (res.ok) {
        const name = students.find((s) => s.id === assignTo)?.name ?? "student";
        toast.success(`Assigned to ${name}`);
        setAssignTo("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't assign");
      }
    });
  }

  function archive() {
    startTransition(async () => {
      const res = await setWorksheetActive(worksheet.id, false);
      if (res.ok) {
        toast.success("Archived");
        router.refresh();
      } else {
        toast.error("Couldn't archive");
      }
    });
  }

  return (
    <li className="rounded-2xl border border-brand-mist bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-plum">{worksheet.title}</p>
          <p className="mt-0.5 text-xs text-brand-ink/55">{tagLine(worksheet)}</p>
        </div>
        <button
          type="button"
          onClick={archive}
          disabled={isPending}
          className="shrink-0 text-xs text-brand-ink/45 hover:text-brand-plum disabled:opacity-50"
        >
          Archive
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={assignTo}
          onChange={(e) => setAssignTo(e.target.value)}
          className="rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-xs text-brand-plum focus:outline-none"
        >
          <option value="">Assign to…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={assign}
          disabled={isPending || !assignTo}
          className="rounded-lg bg-brand-plum px-3 py-1.5 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
        >
          Assign
        </button>
      </div>
    </li>
  );
}

function RestoreButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await setWorksheetActive(id, true);
          if (res.ok) {
            toast.success("Restored");
            router.refresh();
          } else {
            toast.error("Couldn't restore");
          }
        })
      }
      className="text-xs text-brand-plum-mid hover:underline disabled:opacity-50"
    >
      Restore
    </button>
  );
}
