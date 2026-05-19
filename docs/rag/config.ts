/**
 * RAG Extension Configuration
 *
 * The documentation corpus is in docs/rag/corpus/ — tracked in git.
 * Vanilla documentation at vanilla/documentation/ is also used when available.
 *
 * API key is read from the RAG_API_KEY environment variable or .env file.
 * Create a .env file in the project root with:
 *   RAG_API_KEY=sk-your-key-here
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load .env file manually (no dotenv dependency).
 * Only reads RAG_API_KEY for now.
 */
function loadEnv(rootDir?: string): void {
  if (process.env.RAG_API_KEY) return; // already set

  const searchPaths = [
    rootDir ? resolve(rootDir, ".env") : "",
    resolve(process.cwd(), ".env"),
  ];

  for (const envPath of searchPaths) {
    if (!envPath) continue;
    try {
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, "utf-8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (key === "RAG_API_KEY" && !process.env.RAG_API_KEY) {
            process.env.RAG_API_KEY = val;
          }
        }
        break;
      }
    } catch {
      // ignore .env read errors
    }
  }
}

export interface RAGConfig {
  /** Base URL for the OpenAI-compatible embedding API */
  embeddingApiUrl: string;
  /** Model name passed to the embedding API */
  embeddingModel: string;
  /** API key for the embedding service (read from RAG_API_KEY env var) */
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

export function defaultConfig(rootDir?: string): RAGConfig {
  // Load .env before reading config
  loadEnv(rootDir);
  return {
    embeddingApiUrl: "https://routerai.ru/api/v1",
    embeddingModel: "qwen/qwen3-embedding-8b",
    embeddingApiKey: process.env.RAG_API_KEY || "",
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
