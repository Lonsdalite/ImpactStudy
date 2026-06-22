import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PracticeGenerator } from "@/components/dashboard/practice-generator";

export const metadata = { title: "Practice" };

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
}

export default async function PracticePage() {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Practice
        </h1>

        {isStaff ? (
          <StaffPractice tenantId={tenant.tenantId} />
        ) : (
          <>
            <p className="mt-2 text-sm text-brand-ink/65">
              Daily practice, tuned to what you find hardest.
            </p>
            <div className="mt-10">
              <EmptyState
                title="No practice yet"
                body="Fresh questions, written in your tutor's voice and aimed at the concepts you find trickiest."
                hint="Coming soon"
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

async function StaffPractice({ tenantId }: { tenantId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, first_name, last_name")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("first_name", { ascending: true });

  const students = ((data ?? []) as unknown as StudentRow[]).map((s) => ({
    id: s.id,
    name: `${s.first_name}${s.last_name ? ` ${s.last_name}` : ""}`,
  }));

  return (
    <>
      <p className="mt-2 text-sm text-brand-ink/65">
        Generate a practice set in your voice. Pick a topic, optionally a
        student, and review before it goes out.
      </p>
      <PracticeGenerator students={students} />
    </>
  );
}
