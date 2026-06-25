/**
 * Pinecone Vector Store Service
 * Handles upsert, query, and index stats for testcase-rag index
 */

import { Pinecone } from "@pinecone-database/pinecone";

const UPSERT_BATCH = 100;

function getClient(apiKey) {
  const key = apiKey || process.env.PINECONE_API_KEY;
  if (!key) throw new Error("PINECONE_API_KEY not configured");
  return new Pinecone({ apiKey: key });
}

function getIndex(client) {
  const indexName = process.env.PINECONE_INDEX || process.env.PINECONE_INDEX_NAME || "testcase-rag";
  return client.index(indexName);
}

/**
 * Upsert chunks with embeddings into Pinecone
 */
export async function upsertChunks(chunks, embeddings, apiKey, onProgress) {
  const client  = getClient(apiKey);
  const index   = getIndex(client);
  const vectors = chunks.map((chunk, i) => ({
    id:       chunk.chunkId,
    values:   embeddings[i],
    metadata: {
      content:      chunk.content.slice(0, 1000), // Pinecone metadata limit
      tokens:       chunk.tokens,
      sourceRows:   JSON.stringify(chunk.sourceRows),
      overlapTokens: chunk.overlapTokens || 0,
      strategy:     chunk.strategy,
      ...chunk.metadata,
    },
  }));

  const totalBatches = Math.ceil(vectors.length / UPSERT_BATCH);
  let   totalUpserted = 0;

  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    const batchNum = Math.floor(i / UPSERT_BATCH) + 1;
    const batch    = vectors.slice(i, i + UPSERT_BATCH);
    const start    = Date.now();

    await index.upsert(batch);
    totalUpserted += batch.length;

    if (onProgress) {
      onProgress({
        batchNum,
        totalBatches,
        upserted:   totalUpserted,
        total:      vectors.length,
        latencyMs:  Date.now() - start,
      });
    }
  }

  return { totalUpserted };
}

/**
 * Query Pinecone with an embedding vector
 */
export async function queryIndex(embedding, topK = 10, apiKey) {
  const client = getClient(apiKey);
  const index  = getIndex(client);
  const start  = Date.now();

  const result = await index.query({
    vector:          embedding,
    topK,
    includeMetadata: true,
    includeValues:   false,
  });

  return {
    matches:   result.matches,
    topK,
    latencyMs: Date.now() - start,
    count:     result.matches.length,
  };
}

/**
 * Get index statistics
 */
export async function getIndexStats(apiKey) {
  const client = getClient(apiKey);
  const index  = getIndex(client);
  const stats  = await index.describeIndexStats();
  return {
    totalVectors:  stats.totalRecordCount || 0,
    dimensions:    stats.dimension || 1024,
    indexFullness: stats.indexFullness || 0,
    namespaces:    stats.namespaces || {},
  };
}

/**
 * Delete all vectors (reset index)
 */
export async function resetIndex(apiKey) {
  const client = getClient(apiKey);
  const index  = getIndex(client);
  try {
    await index.namespace("").deleteAll();
  } catch (err) {
    console.warn("Pinecone deleteAll warning:", err.message);
  }
  return { success: true };
}
