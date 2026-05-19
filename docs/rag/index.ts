/**
 * RAG Extension for pi — HOI4 Mod Documentation RAG
 *
 * Behaviour:
 *   - First prompt of session: injects topK=3 relevant chunks automatically.
 *   - Subsequent prompts: NO injection (to save tokens).
 *   - #RAG <prompt>: forces injection with topK=10 chunks.
 *
 * The documentation corpus lives in docs/rag/corpus/ (git-tracked).
 *
 * Commands:
 *   /rag-status    — show index info + last errors
 *   /rag-logs      — show full error log
 *   /rag-reindex   — rebuild index from source files
 *   /rag-search    — manually search the index
 *   /rag-toggle    — enable/disable RAG injection
 *   /rag-config    — show current configuration
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultConfig, type RAGConfig } from "./config";
import {
  discoverDocumentationFiles,
  chunkFiles,
  type Chunk,
} from "./chunker";
import { OpenAICompatibleEmbedder, batchEmbed } from "./embedder";
import { VectorStore } from "./vector-store";
import { resolve } from "node:path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";

// ─── Module-level state ────────────────────────────────────────────────────

let config: RAGConfig;
let store: VectorStore;
let embedder: OpenAICompatibleEmbedder;

/** Ring buffer of log entries (last N) */
interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}
const MAX_LOG = 50;
const logs: LogEntry[] = [];

function log(level: LogEntry["level"], message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString().slice(11, 23),
    level,
    message,
  };
  logs.push(entry);
  if (logs.length > MAX_LOG) logs.shift();
  if (level === "error") console.error(`[RAG] ${message}`);
  else if (level === "warn") console.warn(`[RAG] ${message}`);
  else console.log(`[RAG] ${message}`);
}

/** Set by #RAG prefix handler */
let forceExtendedRAG = false;
/** Whether we already injected RAG this session (first prompt flag) */
let hasInjectedThisSession = false;
let initialized = false;
let indexing = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getProjectRoot(ctx?: { cwd: string }): string {
  return ctx?.cwd ?? process.cwd();
}

function getCachePath(rootDir: string): string {
  return resolve(rootDir, config.cachePath);
}

function formatChunk(chunk: Chunk & { similarity?: number }): string {
  const sourceInfo = `Source: ${chunk.filePath} > ${chunk.heading}`;
  const relevance =
    chunk.similarity !== undefined
      ? ` (relevance: ${(chunk.similarity * 100).toFixed(0)}%)`
      : "";
  return `### ${sourceInfo}${relevance}\n${chunk.content}`;
}

// ─── Indexing (with detailed step-by-step error reporting) ──────────────────

interface IndexResult {
  chunkCount: number;
  fileCount: number;
}

async function rebuildIndex(rootDir: string): Promise<IndexResult> {
  if (indexing) throw new Error("Indexing already in progress");
  indexing = true;
  log("info", "Starting index rebuild...");

  try {
    // Step 1: discover files
    log("info", "Step 1/4: Discovering documentation files...");
    let files: Array<{ filePath: string; content: string }>;
    try {
      files = discoverDocumentationFiles(config, rootDir);
      log("info", `  Found ${files.length} files`);
      files.forEach((f) => log("debug", `  - ${f.filePath} (${f.content.length} bytes)`));
    } catch (err) {
      const msg = `File discovery failed: ${err instanceof Error ? err.message : String(err)}`;
      log("error", msg);
      throw new Error(msg);
    }

    if (files.length === 0) {
      const msg = `No documentation files found. Checked patterns: ${JSON.stringify(config.includePatterns)} in ${rootDir}`;
      log("error", msg);
      throw new Error(msg);
    }

    // Step 2: chunk files
    log("info", "Step 2/4: Chunking markdown files...");
    let chunks: Chunk[];
    try {
      chunks = chunkFiles(files, config);
      log("info", `  Produced ${chunks.length} chunks`);
    } catch (err) {
      const msg = `Chunking failed: ${err instanceof Error ? err.message : String(err)}`;
      log("error", msg);
      throw new Error(msg);
    }

    if (chunks.length === 0) {
      const msg = "Chunking produced zero chunks — check file formats";
      log("error", msg);
      throw new Error(msg);
    }

    // Log chunk stats
    const sizes = chunks.map((c) => c.content.length);
    sizes.sort((a, b) => a - b);
    const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
    log("info", `  Chunk sizes: min=${sizes[0]} max=${sizes[sizes.length - 1]} avg=${avg}`);

    // Step 3: embed
    log("info", `Step 3/4: Generating embeddings (${chunks.length} chunks)...`);
    const texts = chunks.map((c) => c.content);
    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(embedder, texts, 50);
      log("info", `  Got ${embeddings.length} embeddings, dim=${embeddings[0]?.length || "?"}`);
    } catch (err) {
      const msg = `Embedding failed: ${err instanceof Error ? err.message : String(err)}`;
      log("error", msg);
      throw new Error(msg);
    }

    if (embeddings.length !== chunks.length) {
      const msg = `Embedding count mismatch: ${embeddings.length} embeddings for ${chunks.length} chunks`;
      log("error", msg);
      throw new Error(msg);
    }

    // Step 4: index + cache
    log("info", "Step 4/4: Building index and saving cache...");
    try {
      store.index(chunks, embeddings, config.embeddingModel);
      log("info", `  Index built: ${store.chunkCount} chunks, ${store.fileCount} files`);

      const cachePath = getCachePath(rootDir);
      const saved = store.saveToDisk(cachePath);
      if (saved) {
        log("info", `  Cache saved to ${cachePath}`);
      } else {
        log("warn", `  Failed to save cache to ${cachePath} (non-fatal)`);
      }
    } catch (err) {
      const msg = `Index/cache error: ${err instanceof Error ? err.message : String(err)}`;
      log("error", msg);
      throw new Error(msg);
    }

    log("info", `Index rebuild complete: ${chunks.length} chunks from ${files.length} files`);
    return { chunkCount: chunks.length, fileCount: files.length };
  } catch (err) {
    // re-throw after logging
    throw err;
  } finally {
    indexing = false;
  }
}

async function ensureIndex(rootDir: string): Promise<IndexResult> {
  const cachePath = getCachePath(rootDir);

  if (store.loadFromDisk(cachePath)) {
    log("info", `Loaded ${store.chunkCount} chunks from cache (${store.fileCount} files)`);
    return { chunkCount: store.chunkCount, fileCount: store.fileCount };
  }

  log("info", "No valid cache found, building fresh index...");
  return await rebuildIndex(rootDir);
}

// ─── Extension Entry Point ──────────────────────────────────────────────────

export default async function ragExtension(pi: ExtensionAPI) {
  config = defaultConfig(getProjectRoot());
  store = new VectorStore();
  embedder = new OpenAICompatibleEmbedder(
    config.embeddingApiUrl,
    config.embeddingModel,
    config.embeddingApiKey,
  );

  // ── Session start: initialise index & reset state ───────────────────

  pi.on("session_start", async (_event, ctx) => {
    hasInjectedThisSession = false;
    forceExtendedRAG = false;

    if (initialized) return;
    initialized = true;

    const rootDir = getProjectRoot(ctx);
    log("info", `Session start, root=${rootDir}`);

    if (config.enabled) {
      ctx.ui.setStatus("rag", "RAG: loading...");

      try {
        const info = await ensureIndex(rootDir);
        ctx.ui.setStatus(
          "rag",
          `RAG: ${info.chunkCount} chunks | ${info.fileCount} files`,
        );
        log("info", `Ready: ${info.chunkCount} chunks, ${info.fileCount} files`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.setStatus("rag", "RAG: error");
        ctx.ui.notify(`RAG init failed: ${msg.slice(0, 200)}`, "error");
        log("error", `Init failed: ${msg}`);
      }
    } else {
      ctx.ui.setStatus("rag", "RAG: disabled");
    }
  });

  // ── Detect "#RAG" prefix → extended search ─────────────────────────

  pi.on("input", async (event) => {
    if (!config.enabled) return { action: "continue" as const };

    const text = event.text.trim();
    if (text.startsWith(config.extendedPrefix)) {
      forceExtendedRAG = true;
      const cleaned = text.slice(config.extendedPrefix.length).trimStart();
      log("debug", `#RAG prefix detected, extended search queued`);
      return { action: "transform" as const, text: cleaned };
    }

    return { action: "continue" as const };
  });

  // ── Inject RAG context before agent starts ──────────────────────────

  pi.on("before_agent_start", async (event) => {
    if (!config.enabled) return;

    const prompt = event.prompt?.trim();
    if (!prompt || prompt.length < config.minPromptLength) return;

    // Decision logic
    let topK: number;
    if (forceExtendedRAG) {
      topK = config.extendedTopK;
      forceExtendedRAG = false;
      log("debug", `Extended RAG (topK=${topK}) triggered by #RAG prefix`);
    } else if (!hasInjectedThisSession) {
      topK = config.topK;
      hasInjectedThisSession = true;
      log("debug", `First-prompt RAG injection (topK=${topK})`);
    } else {
      return; // skip — not first prompt, no #RAG
    }

    // Build query embedding
    let queryEmbedding: number[];
    try {
      const start = performance.now();
      const embs = await embedder.embed([prompt]);
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      queryEmbedding = embs[0];
      log("debug", `Query embedded in ${elapsed}s`);
    } catch (err) {
      log("error", `Query embedding failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Search
    const results = store.search(
      queryEmbedding,
      topK,
      config.similarityThreshold,
    ) as (Chunk & { similarity: number })[];

    if (results.length === 0) {
      log("debug", `Search returned 0 results (threshold=${config.similarityThreshold})`);
      return;
    }

    // Format within size limits
    let ragText = "";
    let totalChars = 0;

    for (const chunk of results) {
      const formatted = formatChunk(chunk) + "\n\n";
      if (totalChars + formatted.length > config.maxContextChars) break;
      ragText += formatted;
      totalChars += formatted.length;
    }

    if (!ragText) return;

    const ragSection = [
      "",
      "## Relevant HOI4 Documentation",
      "",
      "The following sections from the HOI4 mod documentation are relevant to your task.",
      "Use them as authoritative references when writing focus trees, ideas, decisions, effects, triggers, or modifiers.",
      "",
      ragText.trim(),
      "",
      "---",
    ].join("\n");

    log("debug", `Injected ${results.length} chunks (${totalChars} chars)`);

    return {
      systemPrompt: event.systemPrompt + ragSection,
    };
  });

  // ── Session shutdown ──────────────────────────────────────────────

  pi.on("session_shutdown", async () => {
    initialized = false;
    hasInjectedThisSession = false;
    forceExtendedRAG = false;
    log("info", "Session shut down");
  });

  // ── Commands ──────────────────────────────────────────────────────

  pi.registerCommand("rag-status", {
    description: "Show RAG index status and recent errors",
    handler: async (_args, ctx) => {
      if (!config.enabled) {
        ctx.ui.notify("RAG is disabled. Use /rag-toggle to enable.", "warning");
        return;
      }

      const recentErrors = logs
        .filter((l) => l.level === "error")
        .slice(-3);

      if (store.chunkCount === 0) {
        let out = "RAG index is empty.";
        if (recentErrors.length > 0) {
          out += "\n\nRecent errors:\n" + recentErrors.map((e) => `  ${e.timestamp} ${e.message}`).join("\n");
        }
        ctx.ui.notify(out, "warning");
        return;
      }

      const info = store.getInfo();
      const injected = hasInjectedThisSession ? "yes (first prompt done)" : "no";
      const lines = [
        "RAG Index:",
        `  Chunks: ${info.chunkCount}`,
        `  Files: ${info.fileCount}`,
        `  Model: ${config.embeddingModel}`,
        `  Default topK: ${config.topK} (first prompt only)`,
        `  Extended (#RAG): ${config.extendedTopK} (always)`,
        `  Injected this session: ${injected}`,
      ];

      if (recentErrors.length > 0) {
        lines.push("", "Recent errors:");
        for (const e of recentErrors) {
          lines.push(`  ${e.timestamp} ${e.message.slice(0, 150)}`);
        }
        lines.push("", "Use /rag-logs for full log");
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("rag-logs", {
    description: "Show detailed RAG error/operation log",
    handler: async (_args, ctx) => {
      if (logs.length === 0) {
        ctx.ui.notify("No log entries yet.", "info");
        return;
      }

      const lines = logs.map((e) => {
        const tag = e.level === "error" ? "ERR" : e.level === "warn" ? "WRN" : e.level === "debug" ? "DBG" : "INF";
        return `${e.timestamp} [${tag}] ${e.message}`;
      });

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("rag-reindex", {
    description: "Rebuild RAG index from source documentation files",
    handler: async (_args, ctx) => {
      if (!config.enabled) {
        ctx.ui.notify("RAG is disabled. Use /rag-toggle to enable.", "warning");
        return;
      }

      const rootDir = getProjectRoot(ctx);
      ctx.ui.setStatus("rag", "RAG: indexing...");
      ctx.ui.notify("Rebuilding RAG index (check logs for progress)...", "info");

      try {
        const info = await rebuildIndex(rootDir);
        ctx.ui.setStatus(
          "rag",
          `RAG: ${info.chunkCount} chunks | ${info.fileCount} files`,
        );
        ctx.ui.notify(
          `Index rebuilt: ${info.chunkCount} chunks from ${info.fileCount} files`,
          "success",
        );
        hasInjectedThisSession = false;
      } catch (err) {
        ctx.ui.setStatus("rag", "RAG: error");
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Index rebuild failed: ${msg.slice(0, 200)}`, "error");
      }
    },
  });

  pi.registerCommand("rag-search", {
    description: "Search RAG index manually. Usage: /rag-search <query>",
    handler: async (args, ctx) => {
      if (!config.enabled) {
        ctx.ui.notify("RAG is disabled.", "warning");
        return;
      }
      if (!args || args.trim().length < 3) {
        ctx.ui.notify("Usage: /rag-search <query>", "warning");
        return;
      }
      if (store.chunkCount === 0) {
        ctx.ui.notify("RAG index is empty. Run /rag-reindex first.", "warning");
        return;
      }

      ctx.ui.notify("Searching...", "info");
      try {
        const embs = await embedder.embed([args]);
        const results = store.search(
          embs[0],
          config.extendedTopK,
          0,
        ) as (Chunk & { similarity: number })[];

        if (results.length === 0) {
          ctx.ui.notify("No relevant results found.", "info");
          return;
        }

        const lines = results.map(
          (r, i) =>
            `${i + 1}. [${(r.similarity * 100).toFixed(0)}%] ${r.filePath} > ${r.heading}`,
        );
        ctx.ui.notify(`Top ${results.length} results:\n${lines.join("\n")}`, "info");
      } catch (err) {
        ctx.ui.notify(
          `Search failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("rag-toggle", {
    description: "Enable or disable RAG context injection",
    handler: async (_args, ctx) => {
      config.enabled = !config.enabled;

      if (config.enabled) {
        ctx.ui.setStatus("rag", "RAG: enabled");
        ctx.ui.notify("RAG enabled", "success");
        if (store.chunkCount === 0) {
          const rootDir = getProjectRoot(ctx);
          try {
            await ensureIndex(rootDir);
          } catch {
            // user can /rag-reindex
          }
        }
      } else {
        ctx.ui.setStatus("rag", "RAG: disabled");
        ctx.ui.notify("RAG disabled", "info");
      }
    },
  });

  pi.registerCommand("rag-config", {
    description: "Show current RAG configuration",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        [
          "RAG Configuration:",
          `  Enabled: ${config.enabled}`,
          `  Model: ${config.embeddingModel}`,
          `  API: ${config.embeddingApiUrl}`,
          `  Default topK: ${config.topK} (first prompt only)`,
          `  Extended topK (#RAG): ${config.extendedTopK} (always)`,
          `  Similarity threshold: ${config.similarityThreshold}`,
          `  Min prompt length: ${config.minPromptLength}`,
          `  Max context chars: ${config.maxContextChars}`,
          `  Cache: ${config.cachePath}`,
          `  Corpus: docs/rag/corpus/`,
        ].join("\n"),
        "info",
      );
    },
  });
}
