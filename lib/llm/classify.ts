import "server-only";

/**
 * Classification seam (cheap, non-voice LLM work).
 *
 * First consumer is CEQR provenance tagging at upload: label each doc as
 * "tutor-original" | "third-party-concept-only" | "reference-only". Also used
 * for concept extraction and other bulk/batch jobs.
 *
 * Routed through one helper so classification can move OpenAI → OSS (Llama /
 * Qwen via Ollama dev, hosted for prod) without touching call sites — see
 * 18_LLM_Stack_and_RAG_Architecture.md §2/§5.
 *
 * IMPORTANT — what does NOT belong here: voice-critical generation (practice
 * questions in the tutor's voice, parent reports, Tutor-AI chat). That stays an
 * explicit Anthropic call by design (doc 18 §2) — the moat, deliberately NOT
 * abstracted so it never gets silently swapped to a cheaper model.
 *
 * NOT wired until Phase 0 Day 4. Bodies throw until a provider is implemented.
 * Model names below are placeholders for "current best in class" (doc 18 §0),
 * not locked — re-evaluate before wiring.
 */

export type LlmProvider = "openai" | "ollama" | "together";

export interface ClassifyOptions {
  provider?: LlmProvider;
  model?: string;
}

export interface ClassifyResult<L extends string> {
  label: L;
  /** 0–1 if the provider/model exposes one; otherwise undefined. */
  confidence?: number;
  provider: LlmProvider;
  model: string;
}

const DEFAULTS = {
  provider: (process.env.CLASSIFY_PROVIDER as LlmProvider) ?? "openai",
  model: process.env.CLASSIFY_MODEL ?? "gpt-4.1-mini",
} as const;

/**
 * Single-label classification over a closed set of `labels`.
 * Generic over the label union so call sites get a typed result.
 */
export async function classify<L extends string>(
  input: string,
  labels: readonly L[],
  opts: ClassifyOptions = {},
): Promise<ClassifyResult<L>> {
  const provider = opts.provider ?? DEFAULTS.provider;
  const model = opts.model ?? DEFAULTS.model;

  if (labels.length === 0) {
    throw new Error("[classify] `labels` must be a non-empty set");
  }

  switch (provider) {
    case "openai":
    case "ollama":
    case "together":
      // Day 4: implement constrained classification (e.g. structured output /
      // logit-bias to `labels`) and return the winning label + confidence.
      throw new Error(
        `[classify] provider "${provider}" (model "${model}") not wired yet — ` +
          `lands in Phase 0 Day 4. This seam exists so call sites stay stable.`,
      );
    default:
      throw new Error(`[classify] unknown provider "${provider}"`);
  }
}
