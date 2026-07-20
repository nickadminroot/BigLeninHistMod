#!/usr/bin/env node
/**
 * Standalone HOI4 documentation search CLI.
 *
 * Uses only Node.js built-ins. Lexical search (BM25 + grep) works offline;
 * semantic search/reindex additionally requires RAG_API_KEY.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const DEFAULT_CONFIG = {
  embeddingApiUrl: "https://routerai.ru/api/v1",
  embeddingModel: "qwen/qwen3-embedding-8b",
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

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "what", "when", "with",
  "а", "без", "бы", "в", "во", "для", "до", "и", "из", "или", "как", "к", "на", "над", "не", "но", "о", "об", "от", "по", "под", "при", "с", "со", "у", "что", "это",
]);

function printHelp() {
  console.log(`HOI4 documentation search\n\nUsage:\n  node scripts/docs-search.mjs --query <text> [options]\n  node scripts/docs-search.mjs <text> [options]\n  node scripts/docs-search.mjs --status [options]\n  node scripts/docs-search.mjs --reindex [options]\n\nOptions:\n  -q, --query <text>       Search query (at least 2 characters)\n  -m, --mode <mode>        hybrid, bm25, grep, or semantic (default: hybrid)\n  -l, --limit <n>          Number of results, 1-12 (default: 5)\n      --file-pattern <s>   Restrict results to a path substring\n      --root <path>        Project root (default: current directory)\n      --cache <path>       Cache path relative to root or absolute path\n      --json                Emit machine-readable JSON\n      --status              Show corpus and cache status\n      --reindex             Rebuild the semantic index (requires RAG_API_KEY)\n  -h, --help               Show this help\n\nEnvironment:\n  RAG_API_KEY              Enables semantic search and --reindex\n  RAG_API_URL              Override the embedding API URL\n  RAG_EMBEDDING_MODEL      Override the embedding model\n`);
}

function loadEnv(rootDir) {
  if (process.env.RAG_API_KEY) return;
  const candidates = [resolve(rootDir, ".env"), resolve(process.cwd(), ".env")];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    try {
      for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*RAG_API_KEY\s*=\s*(.*?)\s*$/);
        if (match && !process.env.RAG_API_KEY) {
          process.env.RAG_API_KEY = match[1].replace(/^['"]|['"]$/g, "");
        }
      }
      break;
    } catch {
      // Offline lexical search remains available.
    }
  }
}

function createConfig(rootDir, cacheOverride) {
  loadEnv(rootDir);
  return {
    ...DEFAULT_CONFIG,
    embeddingApiUrl: process.env.RAG_API_URL || DEFAULT_CONFIG.embeddingApiUrl,
    embeddingModel: process.env.RAG_EMBEDDING_MODEL || DEFAULT_CONFIG.embeddingModel,
    embeddingApiKey: process.env.RAG_API_KEY || "",
    cachePath: cacheOverride || DEFAULT_CONFIG.cachePath,
  };
}

function cachePathFor(rootDir, config) {
  return resolve(rootDir, config.cachePath);
}

function analyzeQuery(query) {
  const raw = query.toLocaleLowerCase().match(/[\p{L}\p{N}_.$:-]+/gu) || [];
  const terms = new Set();
  for (const token of raw) {
    if (token.length > 1 && !STOP_WORDS.has(token)) terms.add(token);
    if (token.includes("_")) {
      for (const part of token.split("_").filter((value) => value.length > 1)) {
        if (!STOP_WORDS.has(part)) terms.add(part);
      }
    }
  }
  return [...terms];
}

function tokenize(text) {
  const raw = text.toLocaleLowerCase().match(/[\p{L}\p{N}_.$:-]+/gu) || [];
  const tokens = [];
  for (const token of raw) {
    if (token.length > 1 && !STOP_WORDS.has(token)) tokens.push(token);
    if (token.includes("_")) {
      for (const part of token.split("_").filter((value) => value.length > 1)) {
        if (!STOP_WORDS.has(part)) tokens.push(part);
      }
    }
  }
  return tokens;
}

function createChunkId(filePath, heading, index) {
  const safePath = filePath.replace(/[/\\:]/g, "_");
  const safeHeading = heading.replace(/[^a-zA-Z0-9_\u0080-\uFFFF]/g, "_").slice(0, 48);
  return `${safePath}_${safeHeading}_${index}`;
}

function headingText(line) {
  return line.replace(/^#+\s*/, "").trim();
}

function cleanHeadingPrefix(heading, filePath) {
  const base = filePath.replace(/\.md$/i, "").replace(/[/\\]/g, "_").toLowerCase();
  const lower = heading.toLowerCase();
  for (const prefix of [base + ".md", base]) {
    if (!lower.startsWith(prefix)) continue;
    const cleaned = heading.slice(prefix.length);
    if (!cleaned) break;
    return cleaned.toLowerCase().startsWith(".md") && cleaned.length > 3
      ? cleaned.slice(3)
      : cleaned;
  }
  return heading;
}

function splitLargeChunk(fullText, parentHeading, filePath, maxSize) {
  const lines = fullText.split(/\r?\n/);
  const subPositions = lines.map((line, index) => /^### (?!#)/.test(line) ? index : -1).filter((index) => index >= 0);
  const result = [];

  if (subPositions.length > 1) {
    for (let i = 0; i < subPositions.length; i++) {
      const text = lines.slice(subPositions[i], subPositions[i + 1] ?? lines.length).join("\n").trim();
      if (text.length >= 10) {
        const heading = cleanHeadingPrefix(headingText(lines[subPositions[i]]), filePath);
        result.push({ id: createChunkId(filePath, `${parentHeading} > ${heading}`, result.length), filePath, heading, content: text });
      }
    }
    if (result.length) return result;
  }

  let current = "";
  for (const line of lines) {
    if (current.length + line.length > maxSize && current) {
      if (current.trim().length >= 10) {
        result.push({ id: createChunkId(filePath, parentHeading, result.length), filePath, heading: parentHeading, content: current.trim() });
      }
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current.trim().length >= 10) {
    result.push({ id: createChunkId(filePath, parentHeading, result.length), filePath, heading: parentHeading, content: current.trim() });
  }
  return result;
}

function mergeTinyChunks(chunks, minSize) {
  if (chunks.length <= 1) return chunks;
  const result = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.content.length < minSize && i < chunks.length - 1) {
      chunks[i + 1] = {
        ...chunks[i + 1],
        content: `${chunk.content}\n\n${chunks[i + 1].content}`,
        id: createChunkId(chunk.filePath, chunks[i + 1].heading, result.length),
      };
    } else if (chunk.content.length < minSize && result.length) {
      const previous = result[result.length - 1];
      result[result.length - 1] = {
        ...previous,
        content: `${previous.content}\n\n${chunk.content}`,
        id: createChunkId(previous.filePath, previous.heading, result.length - 1),
      };
    } else {
      result.push(chunk);
    }
  }
  return result;
}

function chunkMarkdown(content, filePath, maxChunkSize, minChunkSize = 200) {
  const lines = content.split(/\r?\n/);
  const headingPositions = lines.map((line, index) => /^## (?!#)/.test(line) ? index : -1).filter((index) => index >= 0);
  if (!headingPositions.length) {
    const trimmed = content.trim();
    return trimmed ? [{ id: createChunkId(filePath, "(root)", 0), filePath, heading: "(root)", content: trimmed }] : [];
  }

  const raw = [];
  for (let i = 0; i < headingPositions.length; i++) {
    const start = headingPositions[i];
    const end = headingPositions[i + 1] ?? lines.length;
    const line = lines[start];
    const heading = headingText(line);
    if (["table of content", "table of contents"].includes(heading.toLowerCase())) continue;
    const cleanedHeading = cleanHeadingPrefix(heading, filePath);
    const body = lines.slice(start + 1, end).join("\n").trim();
    const chunkText = `${line.trim()}\n${body}`;
    if (chunkText.trim().length < 10) continue;
    if (chunkText.length > maxChunkSize) raw.push(...splitLargeChunk(chunkText, cleanedHeading, filePath, maxChunkSize));
    else raw.push({ id: createChunkId(filePath, cleanedHeading, raw.length), filePath, heading: cleanedHeading, content: chunkText });
  }

  const merged = mergeTinyChunks(raw, minChunkSize);
  merged.forEach((chunk, index) => { chunk.id = createChunkId(chunk.filePath, chunk.heading, index); });
  return merged;
}

function walkDir(dir, callback) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) walkDir(fullPath, callback);
      else if (entry.isFile()) callback(fullPath);
    }
  } catch {
    // Skip unreadable directories.
  }
}

function matchGlob(filePath, pattern) {
  const pathText = filePath.replace(/\\/g, "/");
  const patternText = pattern.replace(/\\/g, "/");
  let regex = "^";
  for (let i = 0; i < patternText.length;) {
    const char = patternText[i];
    if (char === "*" && patternText[i + 1] === "*") {
      regex += ".*";
      i += 2;
      if (patternText[i] === "/") i++;
    } else if (char === "*") {
      regex += "[^/]*";
      i++;
    } else if (char === "?") {
      regex += "[^/]";
      i++;
    } else {
      regex += /[.+^${}()|\[\]\\]/.test(char) ? `\\${char}` : char;
      i++;
    }
  }
  try { return new RegExp(`${regex}$`, "i").test(pathText); } catch { return false; }
}

function resolvePatterns(patterns, rootDir) {
  const results = new Set();
  for (const pattern of patterns) {
    if (!pattern.includes("*") && !pattern.includes("?")) {
      const fullPath = resolve(rootDir, pattern);
      try { if (statSync(fullPath).isFile()) results.add(fullPath); } catch { /* missing */ }
      continue;
    }
    const wildcardPositions = [pattern.indexOf("*"), pattern.indexOf("?")].filter((index) => index >= 0);
    const firstWildcard = Math.min(...wildcardPositions);
    const beforeWildcard = pattern.slice(0, firstWildcard);
    const lastSeparator = beforeWildcard.lastIndexOf("/");
    const baseDir = resolve(rootDir, lastSeparator >= 0 ? beforeWildcard.slice(0, lastSeparator) : ".");
    walkDir(baseDir, (filePath) => {
      const relativePath = relative(rootDir, filePath).replace(/\\/g, "/");
      if (matchGlob(relativePath, pattern)) results.add(filePath);
    });
  }
  return [...results];
}

function discoverChunks(rootDir, config) {
  const files = resolvePatterns(config.includePatterns, rootDir).map((filePath) => {
    try { return { filePath: relative(rootDir, filePath).replace(/\\/g, "/"), content: readFileSync(filePath, "utf8") }; }
    catch { return null; }
  }).filter(Boolean);
  const chunks = files.flatMap((file) => chunkMarkdown(file.content, file.filePath, config.maxChunkSize));
  return { files, chunks };
}

class LexicalIndex {
  build(chunks) {
    this.chunks = chunks;
    this.termFrequencies = [];
    this.documentFrequencies = new Map();
    this.lengths = [];
    for (const chunk of chunks) {
      const frequencies = new Map();
      for (const token of tokenize(`${chunk.filePath} ${chunk.heading} ${chunk.content}`)) frequencies.set(token, (frequencies.get(token) || 0) + 1);
      this.termFrequencies.push(frequencies);
      this.lengths.push([...frequencies.values()].reduce((sum, value) => sum + value, 0));
      for (const term of frequencies.keys()) this.documentFrequencies.set(term, (this.documentFrequencies.get(term) || 0) + 1);
    }
    const totalLength = this.lengths.reduce((sum, length) => sum + length, 0);
    this.averageLength = chunks.length ? Math.max(1, totalLength / chunks.length) : 1;
  }

  filter(chunk, filePattern) {
    return !filePattern || chunk.filePath.toLocaleLowerCase().includes(filePattern.toLocaleLowerCase());
  }

  searchBm25(query, limit, filePattern) {
    const terms = analyzeQuery(query);
    if (!terms.length) return [];
    const hits = [];
    const n = this.chunks.length;
    for (let index = 0; index < this.chunks.length; index++) {
      const chunk = this.chunks[index];
      if (!this.filter(chunk, filePattern)) continue;
      const frequencies = this.termFrequencies[index];
      let score = 0;
      const matchedTerms = [];
      for (const term of terms) {
        const tf = frequencies.get(term) || 0;
        if (!tf) continue;
        matchedTerms.push(term);
        const df = this.documentFrequencies.get(term) || 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const denominator = tf + 1.5 * (1 - 0.75 + 0.75 * (this.lengths[index] / this.averageLength));
        score += idf * ((tf * 2.5) / denominator);
      }
      if (score > 0) hits.push({ chunk, score, matchedTerms });
    }
    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  searchGrep(query, limit, filePattern) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const terms = analyzeQuery(query);
    if (!normalizedQuery || !terms.length) return [];
    const hits = [];
    for (const chunk of this.chunks) {
      if (!this.filter(chunk, filePattern)) continue;
      const heading = chunk.heading.toLocaleLowerCase();
      const path = chunk.filePath.toLocaleLowerCase();
      const content = chunk.content.toLocaleLowerCase();
      const matchedTerms = terms.filter((term) => heading.includes(term) || path.includes(term) || content.includes(term));
      if (!matchedTerms.length) continue;
      let score = matchedTerms.length / terms.length;
      if (content.includes(normalizedQuery)) score += 3;
      if (heading.includes(normalizedQuery)) score += 4;
      if (path.includes(normalizedQuery)) score += 2;
      for (const term of matchedTerms) {
        if (heading.includes(term)) score += 1.5;
        if (path.includes(term)) score += 0.75;
      }
      hits.push({ chunk, score, matchedTerms });
    }
    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

class VectorStore {
  index(chunks, embeddings, model) {
    this.chunks = chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }));
    this.embeddings = embeddings;
    this.model = model || "";
    this.normalizedEmbeddings = embeddings.map((embedding) => normalizeVector(embedding));
    this.files = new Set(chunks.map((chunk) => chunk.filePath));
  }

  clear() {
    this.chunks = [];
    this.embeddings = [];
    this.normalizedEmbeddings = null;
    this.files = new Set();
    this.model = "";
  }

  get chunkCount() { return this.chunks?.length || 0; }
  get fileCount() { return this.files?.size || 0; }

  search(queryEmbedding, topK, threshold = 0) {
    if (!this.chunkCount || !this.normalizedEmbeddings) return [];
    const query = normalizeVector(queryEmbedding);
    const scored = [];
    for (let i = 0; i < this.normalizedEmbeddings.length; i++) {
      let score = 0;
      for (let j = 0; j < this.normalizedEmbeddings[i].length; j++) score += (query[j] || 0) * this.normalizedEmbeddings[i][j];
      if (score >= threshold) scored.push({ index: i, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK).map(({ index, score }) => ({ ...this.chunks[index], similarity: score }));
  }

  load(cachePath) {
    this.clear();
    if (!existsSync(cachePath)) return false;
    try {
      const data = JSON.parse(readFileSync(cachePath, "utf8"));
      if (data.version !== 1) throw new Error(`Unsupported cache version: ${data.version}`);
      this.index(data.chunks, data.chunks.map((chunk) => chunk.embedding), data.model);
      return this.chunkCount > 0;
    } catch (error) {
      console.error(`[docs-search] Unable to load cache ${cachePath}: ${error.message || error}`);
      return false;
    }
  }

  save(cachePath) {
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify({
        version: 1,
        model: this.model,
        chunks: this.chunks.map(({ id, filePath, heading, content, embedding }) => ({ id, filePath, heading, content, embedding })),
      }, null, 1), "utf8");
      return true;
    } catch (error) {
      console.error(`[docs-search] Unable to save cache ${cachePath}: ${error.message || error}`);
      return false;
    }
  }
}

async function embed(texts, config) {
  if (!texts.length) return [];
  let base = config.embeddingApiUrl.replace(/\/+$/, "");
  if (!base.endsWith("/v1")) base += "/v1";
  const response = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.embeddingApiKey}` },
    body: JSON.stringify({ model: config.embeddingModel, input: texts, encoding_format: "float" }),
  });
  if (!response.ok) throw new Error(`Embedding API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

async function batchEmbed(texts, config) {
  const result = [];
  for (let i = 0; i < texts.length; i += 50) {
    result.push(...await embed(texts.slice(i, i + 50), config));
    if (i + 50 < texts.length) await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  return result;
}

class DocumentationSearch {
  constructor(rootDir, config) {
    this.rootDir = rootDir;
    this.config = config;
    this.lexical = new LexicalIndex();
    this.vector = new VectorStore();
    this.load();
  }

  load() {
    const discovered = discoverChunks(this.rootDir, this.config);
    this.files = discovered.files;
    this.chunks = discovered.chunks;
    this.lexical.build(this.chunks);
    this.vectorReady = this.vector.load(cachePathFor(this.rootDir, this.config));
  }

  async reindex() {
    if (!this.config.embeddingApiKey) throw new Error("RAG_API_KEY is not configured; BM25 and grep are available without it");
    this.load();
    const embeddings = await batchEmbed(this.chunks.map((chunk) => chunk.content), this.config);
    if (embeddings.length !== this.chunks.length) throw new Error(`Embedding API returned ${embeddings.length} vectors for ${this.chunks.length} chunks`);
    this.vector.index(this.chunks, embeddings, this.config.embeddingModel);
    if (!this.vector.save(cachePathFor(this.rootDir, this.config))) throw new Error("Unable to save semantic cache");
    this.vectorReady = true;
    return { fileCount: this.files.length, chunkCount: this.chunks.length };
  }

  addRankedHits(target, hits, channel, weight) {
    hits.forEach((hit, rank) => {
      const current = target.get(hit.chunk.id) || { chunk: hit.chunk, score: 0, channels: [], matchedTerms: [] };
      current.score += weight / (60 + rank + 1);
      if (!current.channels.includes(channel)) current.channels.push(channel);
      current.matchedTerms = [...new Set([...current.matchedTerms, ...hit.matchedTerms])];
      target.set(hit.chunk.id, current);
    });
  }

  async search(query, mode, limit, filePattern) {
    const combined = new Map();
    const poolSize = Math.max(limit * 4, 20);
    let semanticSkipped;
    if (mode === "hybrid" || mode === "bm25") this.addRankedHits(combined, this.lexical.searchBm25(query, poolSize, filePattern), "bm25", 1);
    if (mode === "hybrid" || mode === "grep") this.addRankedHits(combined, this.lexical.searchGrep(query, poolSize, filePattern), "grep", 1.1);
    if (mode === "hybrid" || mode === "semantic") {
      if (!this.config.embeddingApiKey) semanticSkipped = "RAG_API_KEY is not configured";
      else if (!this.vectorReady) semanticSkipped = "semantic cache is missing; run --reindex";
      else {
        try {
          const [queryEmbedding] = await embed([query], this.config);
          const semantic = this.vector.search(queryEmbedding, poolSize).filter((chunk) => !filePattern || chunk.filePath.toLocaleLowerCase().includes(filePattern.toLocaleLowerCase()));
          semantic.forEach((chunk, rank) => {
            const current = combined.get(chunk.id) || { chunk, score: 0, channels: [], matchedTerms: [] };
            current.score += 1.2 / (60 + rank + 1);
            if (!current.channels.includes("semantic")) current.channels.push("semantic");
            combined.set(chunk.id, current);
          });
        } catch (error) {
          semanticSkipped = error.message || String(error);
        }
      }
    }
    if (mode === "semantic" && semanticSkipped) throw new Error(semanticSkipped);
    return { hits: [...combined.values()].sort((a, b) => b.score - a.score).slice(0, limit), semanticSkipped };
  }

  status() {
    return {
      root: this.rootDir,
      files: this.files.length,
      chunks: this.chunks.length,
      vectorChunks: this.vector.chunkCount,
      vectorFiles: this.vector.fileCount,
      embeddingKey: Boolean(this.config.embeddingApiKey),
      cache: cachePathFor(this.rootDir, this.config),
      sources: this.config.includePatterns,
    };
  }
}

function formatResults(query, hits, semanticSkipped, maxResultChars) {
  const lines = [`Query: ${query}`, `Terms: ${analyzeQuery(query).join(", ") || "none"}`, semanticSkipped ? `Semantic: skipped (${semanticSkipped})` : "", ""].filter(Boolean);
  let chars = lines.join("\n").length;
  for (let index = 0; index < hits.length; index++) {
    const hit = hits[index];
    const header = [`## ${index + 1}. ${hit.chunk.filePath} > ${hit.chunk.heading}`, `Channels: ${hit.channels.join(" + ")}; matches: ${hit.matchedTerms.join(", ") || "semantic"}`].join("\n");
    const block = `${header}\n\n${hit.chunk.content.trim()}\n\n`;
    if (chars + block.length > maxResultChars) {
      lines.push(`[Results truncated at ${maxResultChars} characters]`);
      break;
    }
    lines.push(block.trimEnd(), "");
    chars += block.length;
  }
  return lines.join("\n").trim();
}

function parseArgs(argv) {
  const options = { mode: "hybrid", limit: DEFAULT_CONFIG.defaultLimit, json: false, root: process.cwd() };
  const positional = [];
  const valueOptions = new Set(["query", "mode", "limit", "file-pattern", "root", "cache"]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--status") options.status = true;
    else if (arg === "--reindex") options.reindex = true;
    else {
      const short = { "-q": "query", "-m": "mode", "-l": "limit" }[arg];
      const key = short || (arg.startsWith("--") ? arg.slice(2) : null);
      if (!key || !valueOptions.has(key)) {
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
        continue;
      }
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for --${key}`);
      options[key.replaceAll("-", "_")] = value;
    }
  }
  if (!options.query && positional.length) {
    if (positional[0] === "status") options.status = true;
    else if (positional[0] === "reindex") options.reindex = true;
    else options.query = positional.join(" ");
  }
  options.root = resolve(options.root);
  if (!options.help && !options.status && !options.reindex && !options.query) throw new Error("Provide --query, --status, or --reindex (use --help for usage)");
  if (!options.help && !["hybrid", "bm25", "grep", "semantic"].includes(options.mode)) throw new Error(`Invalid mode: ${options.mode}`);
  if (!options.help) {
    options.limit = Number(options.limit);
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 12) throw new Error("--limit must be an integer from 1 to 12");
    if (options.query && options.query.trim().length < 2) throw new Error("Query must contain at least 2 characters");
  }
  return options;
}

function emitJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const config = createConfig(options.root, options.cache);
  const search = new DocumentationSearch(options.root, config);

  if (options.reindex) {
    const info = await search.reindex();
    if (options.json) emitJson({ ok: true, action: "reindex", ...info, cache: cachePathFor(options.root, config) });
    else console.log(`Index rebuilt: ${info.chunkCount} chunks from ${info.fileCount} files\nCache: ${cachePathFor(options.root, config)}`);
    return;
  }

  if (options.status) {
    const status = search.status();
    if (options.json) emitJson(status);
    else console.log([`Root: ${status.root}`, `Files: ${status.files}`, `Chunks: ${status.chunks}`, `Vector chunks: ${status.vectorChunks}`, `Embedding key: ${status.embeddingKey ? "configured" : "not configured"}`, `Cache: ${status.cache}`, `Sources: ${status.sources.join(", ")}`].join("\n"));
    return;
  }

  const result = await search.search(options.query.trim(), options.mode, options.limit, options.file_pattern?.trim() || undefined);
  if (options.json) {
    emitJson({
      query: options.query.trim(),
      mode: options.mode,
      count: result.hits.length,
      terms: analyzeQuery(options.query),
      semanticSkipped: result.semanticSkipped,
      sources: result.hits.map((hit) => ({ path: hit.chunk.filePath, heading: hit.chunk.heading, channels: hit.channels })),
      hits: result.hits.map((hit) => ({ path: hit.chunk.filePath, heading: hit.chunk.heading, content: hit.chunk.content, score: hit.score, channels: hit.channels, matchedTerms: hit.matchedTerms })),
    });
  } else if (result.hits.length) {
    console.log(formatResults(options.query.trim(), result.hits, result.semanticSkipped, config.maxResultChars));
  } else {
    console.log(`No results for “${options.query.trim()}”.`);
  }
}

main().catch((error) => {
  console.error(`docs-search: ${error.message || error}`);
  process.exitCode = 1;
});
