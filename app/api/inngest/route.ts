import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { draftWeeklyReports } from "@/lib/inngest/functions/draft-weekly-reports";

/**
 * Inngest webhook endpoint.
 *
 * The Inngest dashboard ingests this URL during deploy ("sync"). Each
 * registered function below becomes a triggerable job.
 */
const functions = [draftWeeklyReports];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
