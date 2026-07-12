import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import {
  WorksheetLibrary,
  type WorksheetRow,
} from "@/components/dashboard/worksheet-library";

export const metadata = { title: "Worksheet library" };

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
}
interface SubjectRow {
  id: string;
  name: string;
}
interface WorksheetQueryRow {
  id: string;
  title: string;
  year_level: string | null;
  topic: string | null;
  file_name: string;
  active: boolean;
  subject: { name: string } | null;
}

function fullName(first: string, last: string | null) {
  return `${first}${last ? ` ${last}` : ""}`;
}

export default async function WorksheetLibraryPage() {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);
  if (!isStaff) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: subjectData }, { data: studentData }, { data: worksheetData }] =
    await Promise.all([
      supabase
        .from("subjects")
        .select("id, name")
        .eq("tenant_id", tenant.tenantId)
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("students")
        .select("id, first_name, last_name")
        .eq("tenant_id", tenant.tenantId)
        .eq("active", true)
        .order("first_name", { ascending: true }),
      supabase
        .from("worksheets")
        .select("id, title, year_level, topic, file_name, active, subject:subjects(name)")
        .eq("tenant_id", tenant.tenantId)
        .order("created_at", { ascending: false }),
    ]);

  const subjects = (subjectData ?? []) as unknown as SubjectRow[];
  const students = ((studentData ?? []) as unknown as StudentRow[]).map((s) => ({
    id: s.id,
    name: fullName(s.first_name, s.last_name),
  }));
  const worksheets: WorksheetRow[] = (
    (worksheetData ?? []) as unknown as WorksheetQueryRow[]
  ).map((w) => ({
    id: w.id,
    title: w.title,
    subjectName: w.subject?.name ?? null,
    yearLevel: w.year_level,
    topic: w.topic,
    fileName: w.file_name,
    active: w.active,
  }));

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/dashboard/homework"
          className="text-sm text-brand-plum-mid hover:underline"
        >
          ← Homework
        </Link>
        <h1 className="mt-4 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Worksheet library
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          Your reusable, assignable files — separate from the curriculum the AI
          learns from.
        </p>

        <div className="mt-8">
          <WorksheetLibrary
            tenantId={tenant.tenantId}
            subjects={subjects}
            students={students}
            worksheets={worksheets}
          />
        </div>
      </div>
    </main>
  );
}
