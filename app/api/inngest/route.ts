import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

/**
 * Inngest webhook endpoint.
 *
 * The Inngest dashboard ingests this URL during deploy ("sync"). Each
 * registered function below becomes a triggerable job. Empty array today —
 * we add functions as features need them in Phase 1.
 */
const functions: never[] = [];

export const { GET, POST, PUT } = serve({
  client: inngest,
  // @ts-expect-error -- empty function array is fine; type tightens once we add jobs
  functions,
});
