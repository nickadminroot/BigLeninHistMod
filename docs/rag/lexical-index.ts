import type { Chunk } from "./chunker";

export interface LexicalHit {
  chunk: Chunk;
  score: number;
  matchedTerms: string[];
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "what", "when", "with",
  "а", "без", "бы", "в", "во", "для", "до", "и", "из", "или", "как", "к", "на", "над", "не", "но", "о", "об", "от", "по", "под", "при", "с", "со", "у", "что", "это",
]);

export function analyzeQuery(query: string): string[] {
  const raw = query.toLocaleLowerCase().match(/[\p{L}\p{N}_.$:-]+/gu) ?? [];
  const terms = new Set<string>();
  for (const token of raw) {
    if (token.length > 1 && !STOP_WORDS.has(token)) terms.add(token);
    if (token.includes("_")) {
      for (const part of token.split("_").filter((part) => part.length > 1)) {
        if (!STOP_WORDS.has(part)) terms.add(part);
      }
    }
  }
  return [...terms];
}

function tokenize(text: string): string[] {
  const raw = text.toLocaleLowerCase().match(/[\p{L}\p{N}_.$:-]+/gu) ?? [];
  const tokens: string[] = [];
  for (const token of raw) {
    if (token.length > 1 && !STOP_WORDS.has(token)) tokens.push(token);
    if (token.includes("_")) {
      for (const part of token.split("_").filter((part) => part.length > 1)) {
        if (!STOP_WORDS.has(part)) tokens.push(part);
      }
    }
  }
  return tokens;
}

export class LexicalIndex {
  private chunks: Chunk[] = [];
  private termFrequencies: Array<Map<string, number>> = [];
  private documentFrequencies = new Map<string, number>();
  private lengths: number[] = [];
  private averageLength = 1;

  build(chunks: Chunk[]): void {
    this.chunks = chunks;
    this.termFrequencies = [];
    this.documentFrequencies.clear();
    this.lengths = [];

    for (const chunk of chunks) {
      const tokens = tokenize(`${chunk.filePath} ${chunk.heading} ${chunk.content}`);
      const frequencies = new Map<string, number>();
      for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      this.termFrequencies.push(frequencies);
      this.lengths.push(tokens.length);
      for (const term of frequencies.keys()) {
        this.documentFrequencies.set(term, (this.documentFrequencies.get(term) ?? 0) + 1);
      }
    }

    const totalLength = this.lengths.reduce((sum, length) => sum + length, 0);
    this.averageLength = chunks.length > 0 ? Math.max(1, totalLength / chunks.length) : 1;
  }

  searchBm25(query: string, limit: number, filePattern?: string): LexicalHit[] {
    const terms = analyzeQuery(query);
    if (terms.length === 0) return [];

    const n = this.chunks.length;
    const k1 = 1.5;
    const b = 0.75;
    const hits: LexicalHit[] = [];

    for (let index = 0; index < this.chunks.length; index++) {
      const chunk = this.chunks[index];
      if (filePattern && !chunk.filePath.toLocaleLowerCase().includes(filePattern.toLocaleLowerCase())) continue;

      const frequencies = this.termFrequencies[index];
      let score = 0;
      const matchedTerms: string[] = [];
      for (const term of terms) {
        const tf = frequencies.get(term) ?? 0;
        if (tf === 0) continue;
        matchedTerms.push(term);
        const df = this.documentFrequencies.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const denominator = tf + k1 * (1 - b + b * (this.lengths[index] / this.averageLength));
        score += idf * ((tf * (k1 + 1)) / denominator);
      }

      if (score > 0) hits.push({ chunk, score, matchedTerms });
    }

    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  searchGrep(query: string, limit: number, filePattern?: string): LexicalHit[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const terms = analyzeQuery(query);
    if (!normalizedQuery || terms.length === 0) return [];

    const hits: LexicalHit[] = [];
    for (const chunk of this.chunks) {
      if (filePattern && !chunk.filePath.toLocaleLowerCase().includes(filePattern.toLocaleLowerCase())) continue;
      const heading = chunk.heading.toLocaleLowerCase();
      const path = chunk.filePath.toLocaleLowerCase();
      const content = chunk.content.toLocaleLowerCase();
      const matchedTerms = terms.filter((term) => heading.includes(term) || path.includes(term) || content.includes(term));
      if (matchedTerms.length === 0) continue;

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
