/**
 * Cohere Rerank Service
 * Re-ranks retrieved chunks using rerank-english-v3.0
 */

import { CohereClient } from "cohere-ai";

const MODEL = "rerank-english-v3.0";

/**
 * Rerank a list of Pinecone matches against a query
 * @param {string} query    - Original user query
 * @param {Array}  matches  - Pinecone match objects { id, score, metadata }
 * @param {number} topN     - How many to keep after reranking
 * @param {string} apiKey   - Optional override
 */
export async function rerankChunks(query, matches, topN = 3, apiKey) {
  const key    = apiKey || process.env.COHERE_API_KEY;
  if (!key) throw new Error("COHERE_API_KEY not configured");
  const cohere = new CohereClient({ token: key });
  const start  = Date.now();

  // Build documents array from Pinecone metadata
  const documents = matches.map((m) => m.metadata?.content || "");

  const result = await cohere.rerank({
    model:     MODEL,
    query,
    documents,
    topN,
    returnDocuments: true,
  });

  const latency = Date.now() - start;

  // Build before/after comparison for UI
  const before = matches.map((m, i) => ({
    rank:     i + 1,
    chunkId:  m.id,
    score:    parseFloat(m.score.toFixed(4)),
    preview:  (m.metadata?.content || "").slice(0, 120),
    metadata: m.metadata,
  }));

  const after = result.results.map((r, i) => ({
    rank:           i + 1,
    chunkId:        matches[r.index]?.id,
    score:          parseFloat(r.relevanceScore.toFixed(4)),
    originalRank:   r.index + 1,
    promoted:       r.index + 1 > i + 1,
    preview:        (r.document?.text || "").slice(0, 120),
    content:        r.document?.text || "",
    metadata:       matches[r.index]?.metadata,
  }));

  const promoted = after.filter((r) => r.promoted).length;
  const dropped  = matches.length - topN;

  return {
    before,
    after,
    model:         MODEL,
    latencyMs:     latency,
    inputCount:    matches.length,
    outputCount:   topN,
    promoted,
    dropped,
    topN,
  };
}

export function checkConnection() {
  const key = process.env.COHERE_API_KEY;
  if (!key) return Promise.reject(new Error("COHERE_API_KEY not configured"));
  const cohere = new CohereClient({ token: key });
  return cohere.rerank({ query: "test", documents: ["hello world"], topN: 1 })
    .then(() => ({ status: "ok", model: MODEL }))
    .catch(e => ({ status: "error", message: e.message }));
}
