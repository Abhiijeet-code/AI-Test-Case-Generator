/**
 * POST /api/retrieve
 * Query → embed → Pinecone search → Cohere rerank
 * Returns full pipeline trace for UI visualization
 */

import express           from "express";
import { embedText }     from "../services/mistral.js";
import { queryIndex }    from "../services/pinecone.js";
import { rerankChunks }  from "../services/cohere.js";

const router = express.Router();

// ── POST /api/retrieve/query ────────────────────────────────
router.post("/query", async (req, res) => {
  try {
    const { query, topK = 10, topN = 3 } = req.body;

    if (!query?.trim()) {
      return res.status(400).json({ error: "Query is required" });
    }

    const pipeline = { query, steps: [] };

    // ── STEP 1: Embed query ──────────────────────────────
    const embedResult = await embedText(query);
    pipeline.steps.push({
      step:  1,
      label: "Query Embedding",
      data: {
        model:      embedResult.model,
        dimensions: embedResult.dimensions,
        latencyMs:  embedResult.latencyMs,
        tokens:     embedResult.tokens,
        vectorPreview: embedResult.embedding.slice(0, 20), // first 20 dims
      },
    });

    // ── STEP 2: Pinecone vector search ───────────────────
    const searchResult = await queryIndex(embedResult.embedding, topK);
    pipeline.steps.push({
      step:  2,
      label: "Vector Search",
      data: {
        topK:      searchResult.topK,
        latencyMs: searchResult.latencyMs,
        count:     searchResult.count,
        results:   searchResult.matches.map((m, i) => ({
          rank:     i + 1,
          chunkId:  m.id,
          score:    parseFloat(m.score.toFixed(4)),
          preview:  (m.metadata?.content || "").slice(0, 150),
          metadata: m.metadata,
        })),
      },
    });

    // ── STEP 3: Cohere rerank ────────────────────────────
    const rerankResult = await rerankChunks(query, searchResult.matches, topN);
    pipeline.steps.push({
      step:  3,
      label: "Cohere Re-ranking",
      data:  rerankResult,
    });

    // ── STEP 4: Context assembly ─────────────────────────
    const contextTokens = rerankResult.after.reduce(
      (sum, c) => sum + Math.ceil((c.content?.length || 0) / 4), 0
    );
    pipeline.steps.push({
      step:  4,
      label: "Context Assembly",
      data: {
        chunksIncluded: rerankResult.after.length,
        contextTokens,
        chunks:         rerankResult.after,
      },
    });

    res.json({
      success:       true,
      pipeline,
      finalChunks:   rerankResult.after,
      contextTokens,
    });
  } catch (err) {
    console.error("Retrieve error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
