/**
 * Embedding interface and OpenAI-compatible implementation.
 *
 * Uses qwen/qwen3-embedding-8b via routerai.ru (OpenAI-compatible API).
 */

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingResponse {
  object: string;
  data: Array<{
    index: number;
    object: string;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class OpenAICompatibleEmbedder implements Embedder {
  private apiUrl: string;
  private model: string;
  private apiKey: string;

  constructor(apiUrl: string, model: string, apiKey: string) {
    // Normalize URL
    let base = apiUrl.replace(/\/+$/, "");
    if (!base.endsWith("/v1")) {
      base = base + "/v1";
    }
    this.apiUrl = base + "/embeddings";
    this.model = model;
    this.apiKey = apiKey;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embedding API error ${response.status} for ${this.model}: ${errorText}`,
      );
    }

    const data = (await response.json()) as EmbeddingResponse;

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

/**
 * Batch texts to avoid exceeding API limits.
 * Most embedding models handle up to ~100 texts per call.
 */
export async function batchEmbed(
  embedder: Embedder,
  texts: string[],
  batchSize = 50,
): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await embedder.embed(batch);
    allEmbeddings.push(...embeddings);

    // Small delay between batches to avoid rate limits
    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return allEmbeddings;
}
