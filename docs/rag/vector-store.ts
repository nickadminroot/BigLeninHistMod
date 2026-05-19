/**
 * In-memory vector store with cosine similarity search.
 * Supports serialization to/from JSON for caching.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Chunk } from "./chunker";

export interface StoreInfo {
  chunkCount: number;
  fileCount: number;
}

export interface SerializedStore {
  version: number;
  model: string;
  chunks: Array<{
    id: string;
    filePath: string;
    heading: string;
    content: string;
    embedding: number[];
  }>;
}

const CURRENT_VERSION = 1;

/**
 * Normalize a vector to unit length.
 */
function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (mag === 0) return v;
  return v.map((x) => x / mag);
}

export class VectorStore {
  private chunks: Chunk[] = [];
  private embeddings: number[][] = [];
  /** Pre-normalized embeddings for fast dot-product search */
  private normalizedEmbeddings: Float64Array[] | null = null;
  private modelName = "";
  private _filePaths = new Set<string>();

  get fileCount(): number {
    return this._filePaths.size;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  /**
   * Build index from chunks and their embeddings.
   */
  index(chunks: Chunk[], embeddings: number[][], modelName = ""): void {
    this.chunks = chunks.map((c, i) => ({
      ...c,
      embedding: embeddings[i],
    }));
    this.embeddings = embeddings;
    this.modelName = modelName;
    this.normalizedEmbeddings = embeddings.map(
      (e) => new Float64Array(normalize(e)),
    );
    this._filePaths = new Set(chunks.map((c) => c.filePath));
  }

  // --- Search ---

  /**
   * Search for the top-K most similar chunks.
   * Returns chunks sorted by relevance descending.
   */
  search(
    queryEmbedding: number[],
    topK: number,
    threshold = 0.0,
  ): Chunk[] {
    if (this.chunks.length === 0 || this.normalizedEmbeddings === null) {
      return [];
    }

    const queryNorm = normalize(queryEmbedding);
    const scored: Array<{ index: number; score: number }> = [];

    for (let i = 0; i < this.normalizedEmbeddings.length; i++) {
      const emb = this.normalizedEmbeddings[i];
      let dot = 0;
      for (let j = 0; j < emb.length; j++) {
        dot += queryNorm[j] * emb[j];
      }
      if (dot >= threshold) {
        scored.push({ index: i, score: dot });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map((s) => ({
      ...this.chunks[s.index],
      similarity: s.score,
    })) as (Chunk & { similarity: number })[];
  }

  // --- Serialization ---

  serialize(): SerializedStore {
    return {
      version: CURRENT_VERSION,
      model: this.modelName,
      chunks: this.chunks.map((c) => ({
        id: c.id,
        filePath: c.filePath,
        heading: c.heading,
        content: c.content,
        embedding: c.embedding!,
      })),
    };
  }

  deserialize(data: SerializedStore): void {
    if (data.version !== CURRENT_VERSION) {
      throw new Error(
        `Unsupported cache version: ${data.version} (expected ${CURRENT_VERSION})`,
      );
    }
    const chunks: Chunk[] = data.chunks.map((c) => ({
      ...c,
      embedding: c.embedding,
    }));
    const embeddings = data.chunks.map((c) => c.embedding);
    this.index(chunks, embeddings, data.model);
  }

  // --- Persistence ---

  saveToDisk(cachePath: string): boolean {
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(
        cachePath,
        JSON.stringify(this.serialize(), null, 1),
        "utf-8",
      );
      return true;
    } catch (err) {
      console.error(`[RAG] Failed to save cache: ${err}`);
      return false;
    }
  }

  loadFromDisk(cachePath: string): boolean {
    try {
      if (!existsSync(cachePath)) return false;
      const raw = readFileSync(cachePath, "utf-8");
      const data = JSON.parse(raw) as SerializedStore;
      this.deserialize(data);
      return this.chunks.length > 0;
    } catch (err) {
      console.error(`[RAG] Failed to load cache: ${err}`);
      return false;
    }
  }

  getInfo(): StoreInfo {
    return {
      chunkCount: this.chunks.length,
      fileCount: this._filePaths.size,
    };
  }

  clear(): void {
    this.chunks = [];
    this.embeddings = [];
    this.normalizedEmbeddings = null;
    this._filePaths.clear();
    this.modelName = "";
  }
}
