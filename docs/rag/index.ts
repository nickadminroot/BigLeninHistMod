import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { resolve } from "node:path";
import { chunkFiles, discoverDocumentationFiles, type Chunk } from "./chunker";
import { defaultConfig, type RAGConfig } from "./config";
import { batchEmbed, OpenAICompatibleEmbedder } from "./embedder";
import { analyzeQuery, LexicalIndex, type LexicalHit } from "./lexical-index";
import { VectorStore } from "./vector-store";

interface SearchHit {
  chunk: Chunk;
  score: number;
  channels: string[];
  matchedTerms: string[];
}

let config: RAGConfig;
let chunks: Chunk[] = [];
let lexicalIndex = new LexicalIndex();
let vectorStore = new VectorStore();
let embedder: OpenAICompatibleEmbedder;
let rootDir = process.cwd();
let initialized = false;
let indexing = false;

function loadLexicalCorpus(projectRoot: string): { chunkCount: number; fileCount: number } {
  const files = discoverDocumentationFiles(config, projectRoot);
  chunks = chunkFiles(files, config);
  lexicalIndex.build(chunks);
  return { chunkCount: chunks.length, fileCount: files.length };
}

async function rebuildVectorIndex(): Promise<{ chunkCount: number; fileCount: number }> {
  if (indexing) throw new Error("Индекс уже перестраивается");
  if (!config.embeddingApiKey) throw new Error("RAG_API_KEY не задан; BM25 и grep доступны без него");
  indexing = true;
  try {
    const info = loadLexicalCorpus(rootDir);
    const embeddings = await batchEmbed(embedder, chunks.map((chunk) => chunk.content), 50);
    vectorStore.index(chunks, embeddings, config.embeddingModel);
    if (!vectorStore.saveToDisk(resolve(rootDir, config.cachePath))) {
      throw new Error("Не удалось сохранить векторный кэш");
    }
    return info;
  } finally {
    indexing = false;
  }
}

function addRankedHits(
  target: Map<string, SearchHit>,
  hits: LexicalHit[],
  channel: string,
  weight: number,
): void {
  hits.forEach((hit, rank) => {
    const current = target.get(hit.chunk.id) ?? {
      chunk: hit.chunk,
      score: 0,
      channels: [],
      matchedTerms: [],
    };
    current.score += weight / (60 + rank + 1);
    if (!current.channels.includes(channel)) current.channels.push(channel);
    current.matchedTerms = [...new Set([...current.matchedTerms, ...hit.matchedTerms])];
    target.set(hit.chunk.id, current);
  });
}

function addSemanticHits(target: Map<string, SearchHit>, semanticChunks: Array<Chunk & { similarity: number }>): void {
  semanticChunks.forEach((chunk, rank) => {
    const current = target.get(chunk.id) ?? {
      chunk,
      score: 0,
      channels: [],
      matchedTerms: [],
    };
    current.score += 1.2 / (60 + rank + 1);
    current.channels.push("semantic");
    target.set(chunk.id, current);
  });
}

async function searchDocumentation(
  query: string,
  mode: "hybrid" | "bm25" | "grep" | "semantic",
  limit: number,
  filePattern?: string,
): Promise<{ hits: SearchHit[]; semanticSkipped?: string }> {
  const poolSize = Math.max(limit * 4, 20);
  const combined = new Map<string, SearchHit>();
  let semanticSkipped: string | undefined;

  if (mode === "hybrid" || mode === "bm25") {
    addRankedHits(combined, lexicalIndex.searchBm25(query, poolSize, filePattern), "bm25", 1);
  }
  if (mode === "hybrid" || mode === "grep") {
    addRankedHits(combined, lexicalIndex.searchGrep(query, poolSize, filePattern), "grep", 1.1);
  }
  if (mode === "hybrid" || mode === "semantic") {
    if (!config.embeddingApiKey) {
      semanticSkipped = "RAG_API_KEY не задан";
    } else if (vectorStore.chunkCount === 0) {
      semanticSkipped = "векторный кэш отсутствует; выполните /docs-reindex";
    } else {
      try {
        const [queryEmbedding] = await embedder.embed([query]);
        const semantic = vectorStore.search(queryEmbedding, poolSize, 0) as Array<Chunk & { similarity: number }>;
        const filtered = filePattern
          ? semantic.filter((chunk) => chunk.filePath.toLocaleLowerCase().includes(filePattern.toLocaleLowerCase()))
          : semantic;
        addSemanticHits(combined, filtered);
      } catch (error) {
        semanticSkipped = error instanceof Error ? error.message : String(error);
      }
    }
  }

  if (mode === "semantic" && semanticSkipped) throw new Error(semanticSkipped);
  return {
    hits: [...combined.values()].sort((left, right) => right.score - left.score).slice(0, limit),
    semanticSkipped,
  };
}

function formatResults(query: string, hits: SearchHit[], semanticSkipped?: string): string {
  const terms = analyzeQuery(query);
  const lines = [
    `Запрос: ${query}`,
    `Термины: ${terms.join(", ") || "не выделены"}`,
    semanticSkipped ? `Semantic: пропущен (${semanticSkipped})` : "",
    "",
  ].filter(Boolean);

  let chars = lines.join("\n").length;
  for (let index = 0; index < hits.length; index++) {
    const hit = hits[index];
    const header = [
      `## ${index + 1}. ${hit.chunk.filePath} > ${hit.chunk.heading}`,
      `Каналы: ${hit.channels.join(" + ")}; совпадения: ${hit.matchedTerms.join(", ") || "семантическое"}`,
    ].join("\n");
    const block = `${header}\n\n${hit.chunk.content.trim()}\n\n`;
    if (chars + block.length > config.maxResultChars) {
      lines.push(`[Результаты обрезаны по лимиту ${config.maxResultChars} символов]`);
      break;
    }
    lines.push(block.trimEnd(), "");
    chars += block.length;
  }
  return lines.join("\n").trim();
}

export default function docsSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "docs_search",
    label: "HOI4 Docs Search",
    description: "Ищет документацию HOI4 по локальному корпусу. Hybrid объединяет точные совпадения grep, BM25 и доступный векторный RAG. Возвращает выдержки с путями; limit 1-12.",
    promptSnippet: "Search local HOI4 documentation with grep, BM25, and optional semantic RAG",
    promptGuidelines: [
      "Use docs_search early for HOI4 tasks to interpret domain-specific terms and words from the user's prompt before planning or editing.",
      "For unfamiliar HOI4 identifiers, effects, triggers, modifiers, scopes, localization syntax, or modding concepts, query docs_search with both the exact token and a short conceptual phrase; cite returned source paths in reasoning and handoffs.",
      "Do not guess HOI4 syntax when docs_search or local vanilla references can verify it.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Термин, идентификатор или короткий вопрос по HOI4" }),
      mode: Type.Optional(StringEnum(["hybrid", "bm25", "grep", "semantic"] as const)),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
      filePattern: Type.Optional(Type.String({ description: "Подстрока пути для ограничения корпуса" })),
    }),
    async execute(_toolCallId, params) {
      if (!initialized) {
        rootDir = process.cwd();
        config = defaultConfig(rootDir);
        embedder = new OpenAICompatibleEmbedder(config.embeddingApiUrl, config.embeddingModel, config.embeddingApiKey);
        loadLexicalCorpus(rootDir);
        vectorStore.loadFromDisk(resolve(rootDir, config.cachePath));
        initialized = true;
      }
      const query = params.query.trim();
      if (query.length < 2) throw new Error("Запрос должен содержать минимум 2 символа");
      const mode = params.mode ?? "hybrid";
      const limit = Math.min(params.limit ?? config.defaultLimit, config.maxLimit);
      const result = await searchDocumentation(query, mode, limit, params.filePattern?.trim() || undefined);
      const text = result.hits.length > 0
        ? formatResults(query, result.hits, result.semanticSkipped)
        : `По запросу «${query}» ничего не найдено.`;
      return {
        content: [{ type: "text", text }],
        details: {
          query,
          mode,
          count: result.hits.length,
          terms: analyzeQuery(query),
          sources: result.hits.map((hit) => ({ path: hit.chunk.filePath, heading: hit.chunk.heading, channels: hit.channels })),
          semanticSkipped: result.semanticSkipped,
        },
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    rootDir = ctx.cwd;
    config = defaultConfig(rootDir);
    embedder = new OpenAICompatibleEmbedder(config.embeddingApiUrl, config.embeddingModel, config.embeddingApiKey);
    const info = loadLexicalCorpus(rootDir);
    const vectorReady = vectorStore.loadFromDisk(resolve(rootDir, config.cachePath));
    initialized = true;
    ctx.ui.setStatus("docs-search", `HOI4 docs: ${info.chunkCount} chunks${vectorReady ? " + RAG" : ""}`);
  });

  pi.on("session_shutdown", () => {
    initialized = false;
    chunks = [];
    lexicalIndex = new LexicalIndex();
    vectorStore = new VectorStore();
  });

  pi.registerCommand("docs-status", {
    description: "Показать состояние локального поиска документации HOI4",
    handler: async (_args, ctx) => {
      ctx.ui.notify([
        `Lexical chunks: ${chunks.length}`,
        `Vector chunks: ${vectorStore.chunkCount}`,
        `Embedding key: ${config.embeddingApiKey ? "configured" : "not configured"}`,
        `Sources: ${config.includePatterns.join(", ")}`,
        "Автоматическая подстановка документации отключена; используйте docs_search.",
      ].join("\n"), "info");
    },
  });

  pi.registerCommand("docs-reindex", {
    description: "Пересобрать BM25/grep и векторный индекс документации HOI4",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("docs-search", "HOI4 docs: indexing...");
      try {
        const info = await rebuildVectorIndex();
        ctx.ui.setStatus("docs-search", `HOI4 docs: ${info.chunkCount} chunks + RAG`);
        ctx.ui.notify(`Индекс пересобран: ${info.chunkCount} фрагментов из ${info.fileCount} файлов`, "success");
      } catch (error) {
        ctx.ui.setStatus("docs-search", `HOI4 docs: ${chunks.length} chunks`);
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("docs-search", {
    description: "Поиск документации HOI4: /docs-search <запрос>",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("Использование: /docs-search <запрос>", "warning");
        return;
      }
      try {
        const result = await searchDocumentation(args.trim(), "hybrid", config.defaultLimit);
        ctx.ui.notify(result.hits.length > 0 ? formatResults(args.trim(), result.hits, result.semanticSkipped) : "Ничего не найдено", "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
