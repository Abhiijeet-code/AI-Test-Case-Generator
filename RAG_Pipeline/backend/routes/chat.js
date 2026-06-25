/**
 * POST /api/chat
 * Full RAG pipeline: embed → retrieve → rerank → stream LLM response
 * Uses SSE for real-time token streaming + pipeline trace
 */

import express           from "express";
import { embedText }     from "../services/mistral.js";
import { queryIndex }    from "../services/pinecone.js";
import { rerankChunks }  from "../services/cohere.js";
import { streamCompletion, AVAILABLE_MODELS } from "../services/groq.js";

const router = express.Router();

// ── GET /api/chat/models ────────────────────────────────────
router.get("/models", (req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});

// ── POST /api/chat/stream ───────────────────────────────────
// Full pipeline with SSE streaming
router.post("/stream", async (req, res) => {
  const {
    query,
    topK        = 10,
    topN        = 3,
    model       = "llama-3.1-8b-instant",
    temperature = 0.2,
    maxTokens   = 1024,
  } = req.body;

  if (!query?.trim()) {
    return res.status(400).json({ error: "Query is required" });
  }

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");

  const emit = (event, data) => {
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  };

  try {
    // ── STEP 1: Embed query ────────────────────────────
    emit("step", { step: 1, label: "Embedding query", status: "running" });
    const embedResult = await embedText(query);
    emit("step", { step: 1, label: "Embedding query", status: "done",
      data: {
        model:         embedResult.model,
        dimensions:    embedResult.dimensions,
        latencyMs:     embedResult.latencyMs,
        vectorPreview: embedResult.embedding.slice(0, 20),
      },
    });

    // ── STEP 2: Vector search ──────────────────────────
    emit("step", { step: 2, label: "Searching Pinecone", status: "running" });
    const searchResult = await queryIndex(embedResult.embedding, topK);
    emit("step", { step: 2, label: "Searching Pinecone", status: "done",
      data: {
        topK:      searchResult.topK,
        latencyMs: searchResult.latencyMs,
        count:     searchResult.count,
        results:   searchResult.matches.map((m, i) => ({
          rank:    i + 1,
          chunkId: m.id,
          score:   parseFloat(m.score.toFixed(4)),
          preview: (m.metadata?.content || "").slice(0, 120),
        })),
      },
    });

    // ── STEP 3: Cohere rerank ──────────────────────────
    emit("step", { step: 3, label: "Re-ranking with Cohere", status: "running" });
    const rerankResult = await rerankChunks(query, searchResult.matches, topN);
    emit("step", { step: 3, label: "Re-ranking with Cohere", status: "done",
      data: rerankResult });

    // ── STEP 4: Context assembly ───────────────────────
    const contextTokens = rerankResult.after.reduce(
      (sum, c) => sum + Math.ceil((c.content?.length || 0) / 4), 0
    );
    emit("step", { step: 4, label: "Assembling context", status: "done",
      data: { chunksIncluded: rerankResult.after.length, contextTokens } });

    // ── STEP 5: Stream LLM response ───────────────────
    emit("step", { step: 5, label: "Generating with Groq", status: "running",
      data: { model, temperature, maxTokens } });

    // Hand off to Groq streaming service (writes directly to res)
    await streamCompletion(
      query,
      rerankResult.after,
      { model, temperature, maxTokens },
      res
    );

    // streamCompletion calls res.end() internally
  } catch (err) {
    console.error("Chat stream error:", err);
    emit("error", { message: err.message });
    res.end();
  }
});

export default router;
