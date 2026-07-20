import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(rootDir?: string): void {
  if (process.env.RAG_API_KEY) return;

  for (const envPath of [rootDir ? resolve(rootDir, ".env") : "", resolve(process.cwd(), ".env")]) {
    if (!envPath || !existsSync(envPath)) continue;
    try {
      for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
        const match = line.match(/^\s*RAG_API_KEY\s*=\s*(.+?)\s*$/);
        if (match && !process.env.RAG_API_KEY) process.env.RAG_API_KEY = match[1];
      }
      break;
    } catch {
      // Lexical search remains available without an embedding key.
    }
  }
}

export interface RAGConfig {
  embeddingApiUrl: string;
  embeddingModel: string;
  embeddingApiKey: string;
  maxChunkSize: number;
  cachePath: string;
  includePatterns: string[];
  defaultLimit: number;
  maxLimit: number;
  maxResultChars: number;
}

export function defaultConfig(rootDir?: string): RAGConfig {
  loadEnv(rootDir);
  return {
    embeddingApiUrl: "https://routerai.ru/api/v1",
    embeddingModel: "qwen/qwen3-embedding-8b",
    embeddingApiKey: process.env.RAG_API_KEY || "",
    maxChunkSize: 3000,
    cachePath: ".cache/docs-search/rag-cache.json",
    includePatterns: [
      "docs/rag/corpus/*.md",
      ".pi/skills/hoi4-mod-development/SKILL.md",
      ".pi/skills/hoi4-mod-development/references/*.md",
    ],
    defaultLimit: 5,
    maxLimit: 12,
    maxResultChars: 30000,
  };
}
