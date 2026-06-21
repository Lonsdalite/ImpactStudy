import "server-only";

/**
 * Embeddings seam.
 *
 * Every caller that needs a vector goes through `embed()` so we can flip the
 * provider (OpenAI → Ollama on the Mac Mini → hosted OSS like Together/DeepInfra)
 * without touching call sites. See 18_LLM_Stack_and_RAG_Architecture.md §5.
 *
 * NOT wired until Phase 0 Day 4 (CEQR risk-killer). This file locks the shape
 * only — the bodies throw until a provider is implemented.
 *
 * Model freshness (doc 18 §0): the names below are placeholders for "current
 * best embedding model in class", NOT locked. Re-evaluate at Day 4 / Phase 1
 * week 4 against then-current benchmarks before wiring.
 */

export type EmbeddingProvider = "openai" | "ollama" | "together";

export interface EmbedOptions {
  /** Override the default provider for this call. */
  provider?: EmbeddingProvider;
  /** Override the default model for this call. */
  model?: string;
}

export interface EmbedResult {
  provider: EmbeddingProvider;
  model: string;
  /** One vector per input string, in input order. */
  vectors: number[][];
}

/**
 * Defaults are env-driven so prod can swap provider without a deploy-time code
 * change. Day 4 starts on OpenAI (cheap, zero-infra); Phase 1 week 4 flips
 * embeddings to OSS for the baseline-corpus batch.
 */
const DEFAULTS = {
  provider: (process.env.EMBEDDINGS_PROVIDER as EmbeddingProvider) ?? "openai",
  model: process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small",
} as const;

export async function embed(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<EmbedResult> {
  const provider = opts.provider ?? DEFAULTS.provider;
  const model = opts.model ?? DEFAULTS.model;

  switch (provider) {
    case "openai":
    case "ollama":
    case "together":
      // Day 4: implement per-provider calls here, returning { provider, model,
      // vectors }. Batch `texts` per the provider's max-array limit.
      throw new Error(
        `[embeddings] provider "${provider}" (model "${model}") not wired yet — ` +
          `lands in Phase 0 Day 4. This seam exists so call sites stay stable.`,
      );
    default:
      throw new Error(`[embeddings] unknown provider "${provider}"`);
  }
}
