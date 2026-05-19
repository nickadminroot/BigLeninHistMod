/**
 * RAG Extension Configuration
 *
 * The documentation corpus is in docs/rag/corpus/ — tracked in git.
 * Vanilla documentation at vanilla/documentation/ is also used when available.
 */

export interface RAGConfig {
  /** Base URL for the OpenAI-compatible embedding API */
  embeddingApiUrl: string;
  /** Model name passed to the embedding API */
  embeddingModel: string;
  /** API key for the embedding service */
  embeddingApiKey: string;
  /** Default number of chunks to inject on the first prompt */
  topK: number;
  /** Number of chunks when using the #RAG prefix (always injects) */
  extendedTopK: number;
  /** Prompt prefix that triggers extended search */
  extendedPrefix: string;
  /** Maximum chunk size in characters */
  maxChunkSize: number;
  /** Path to the embedding cache file, relative to project root */
  cachePath: string;
  /** Glob/file patterns for documentation sources (relative to project root) */
  includePatterns: string[];
  /** Master switch */
  enabled: boolean;
  /** Minimum prompt length to trigger RAG search */
  minPromptLength: number;
  /** Minimum cosine similarity threshold */
  similarityThreshold: number;
  /** Maximum total characters injected into system prompt */
  maxContextChars: number;
}

export function defaultConfig(): RAGConfig {
  return {
    embeddingApiUrl: "https://routerai.ru/api/v1",
    embeddingModel: "qwen/qwen3-embedding-8b",
    embeddingApiKey: "sk-BTgD8Xhm6GEU3GWWBPSH9FSR4VE23i8_",
    topK: 3,
    extendedTopK: 10,
    extendedPrefix: "#RAG",
    maxChunkSize: 3000,
    cachePath: ".pi/rag-cache.json",
    // docs/rag/corpus/ — git-tracked curated documentation
    // vanilla/documentation/ — local vanilla files (not in git, fallback)
    includePatterns: [
      "docs/rag/corpus/*.md",
    ],
    enabled: true,
    minPromptLength: 15,
    similarityThreshold: 0.25,
    maxContextChars: 12000,
  };
}
