"use server";

import { resolveActiveTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import {
  generatePracticeSet,
  type PracticeSet,
} from "@/lib/llm/generate-practice";

export async function generatePractice(input: {
  topic: string;
  studentId?: string;
}): Promise<{ ok: boolean; set?: PracticeSet; error?: string }> {
  const res = await resolveActiveTenant();
  if (
    res.status !== "ok" ||
    !["owner", "admin", "tutor"].includes(res.tenant.role)
  ) {
    return { ok: false, error: "Only tutors and admins can generate practice." };
  }
  const topic = input.topic?.trim();
  if (!topic) return { ok: false, error: "Enter a topic first." };

  let studentName: string | undefined;
  let yearLevel: string | undefined;
  if (input.studentId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("students")
      .select("first_name, year_level")
      .eq("id", input.studentId)
      .single();
    if (data) {
      const s = data as unknown as {
        first_name: string;
        year_level: string | null;
      };
      studentName = s.first_name;
      yearLevel = s.year_level ?? undefined;
    }
  }

  try {
    const set = await generatePracticeSet({ topic, studentName, yearLevel });
    return { ok: true, set };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Generation failed.",
    };
  }
}
