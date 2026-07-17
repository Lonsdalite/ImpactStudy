import { redirect } from "next/navigation";
import { resolveActiveTenant } from "@/lib/tenant";
import { getTenantVoice } from "@/lib/voice.server";
import { VoiceCapture } from "@/components/dashboard/voice-capture";

export const metadata = { title: "Voice" };

export default async function VoicePage() {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);

  if (!isStaff) {
    return (
      <main className="flex-1 px-6 py-10 md:px-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-3xl tracking-tight text-brand-plum">
            Voice
          </h1>
          <p className="mt-3 text-sm text-brand-ink/65">
            This is where tutors set their teaching voice.
          </p>
        </div>
      </main>
    );
  }

  // Drizzle, not the supabase-js path: `authenticated` has no column privilege
  // on tenants.voice_signature (policies.sql §3 — it would otherwise be readable
  // by students and parents). See lib/voice.server.ts.
  const voice = await getTenantVoice(tenant.tenantId);

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Your voice
        </h1>
        <p className="mt-2 max-w-xl text-sm text-brand-ink/65">
          This is how the AI writes <em>as you</em> — practice questions today,
          parent reports next. Capture it once from your own messages, edit
          anything that isn&apos;t quite right, and it carries through
          everywhere.
        </p>
        {voice ? (
          <p className="mt-2 text-xs text-brand-sage">
            ✓ A voice is saved. Editing below updates it.
          </p>
        ) : (
          <p className="mt-2 text-xs text-brand-ink/45">
            No voice saved yet — using the default until you capture yours.
          </p>
        )}

        <VoiceCapture initialVoice={voice} />
      </div>
    </main>
  );
}
