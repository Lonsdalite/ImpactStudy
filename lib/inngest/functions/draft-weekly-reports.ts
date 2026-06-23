import { inngest } from "@/lib/inngest/client";
import { draftWeeklyReportsAllTenants } from "@/lib/reports-draft";

/**
 * The automatic heartbeat (20_Product_UX_and_Moat.md §7.2): every Friday evening
 * (Sydney), draft this week's parent note for every active student in every
 * tenant. Drafts only — the tutor still reviews + approves before anything
 * reaches a parent (§7.3). The same core powers the tutor's manual
 * "Draft this week's notes" button.
 */
export const draftWeeklyReports = inngest.createFunction(
  {
    id: "draft-weekly-reports",
    name: "Draft weekly parent reports",
    triggers: [{ cron: "TZ=Australia/Sydney 0 17 * * 5" }], // Fri 17:00 Sydney
  },
  async ({ step }) => {
    const summaries = await step.run("draft-all-tenants", () =>
      draftWeeklyReportsAllTenants(),
    );
    return { summaries };
  },
);
