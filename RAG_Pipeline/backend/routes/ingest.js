/**
 * POST /api/ingest
 * Handles file upload → parse → chunk → embed → upsert to Pinecone
 * Streams progress back via SSE
 */

import express      from "express";
import multer       from "multer";
import Papa         from "papaparse";
import * as XLSX    from "xlsx";
import { chunkRows, getChunkStats } from "../utils/chunker.js";
import { embedBatch }               from "../services/mistral.js";
import { upsertChunks, getIndexStats, resetIndex } from "../services/pinecone.js";

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── POST /api/ingest/upload ─────────────────────────────────
// Full pipeline: parse → chunk → embed → upsert (SSE stream)
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file         = req.file;
    const chunkSize    = parseInt(req.body.chunkSize    || "300");
    const chunkOverlap = parseInt(req.body.chunkOverlap || "50");
    const strategy     = req.body.strategy              || "sliding-window";
    const resetBeforeIngest = req.body.reset === "true";

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // ── SSE headers ────────────────────────────────────────
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");

    const emit = (event, data) => {
      res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
    };

    // ── STEP 1: Parse file ─────────────────────────────────
    emit("step", { step: 1, label: "Parsing file", status: "running" });

    let rows    = [];
    let columns = [];

    if (file.originalname.endsWith(".csv")) {
      const text   = file.buffer.toString("utf8");
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      rows    = parsed.data;
      columns = parsed.meta.fields || [];
    } else {
      const wb    = XLSX.read(file.buffer, { type: "buffer" });
      const ws    = wb.Sheets[wb.SheetNames[0]];
      const data  = XLSX.utils.sheet_to_json(ws, { defval: "" });
      rows    = data;
      columns = data.length ? Object.keys(data[0]) : [];
    }

    emit("step", { step: 1, label: "Parsing file", status: "done",
      data: { totalRows: rows.length, columns, preview: rows.slice(0, 5) } });

    // ── STEP 2: Chunking ───────────────────────────────────
    emit("step", { step: 2, label: "Chunking data", status: "running" });

    const chunks   = chunkRows(rows, columns, { chunkSize, chunkOverlap, strategy });
    const stats    = getChunkStats(chunks);

    emit("step", { step: 2, label: "Chunking data", status: "done",
      data: { chunks: chunks.map(c => ({
        chunkId:       c.chunkId,
        tokens:        c.tokens,
        overlapTokens: c.overlapTokens,
        sourceRows:    c.sourceRows,
        preview:       c.content.slice(0, 200),
        strategy:      c.strategy,
        metadata:      c.metadata,
      })), stats } });

    // ── STEP 3: Embed chunks ───────────────────────────────
    emit("step", { step: 3, label: "Generating embeddings", status: "running",
      data: { model: "mistral-embed", totalChunks: chunks.length } });

    const texts      = chunks.map((c) => c.content);
    const embeddings = await embedBatch(texts, null, (progress) => {
      emit("progress", { step: 3, ...progress });
    });

    emit("step", { step: 3, label: "Generating embeddings", status: "done",
      data: { dimensions: embeddings[0]?.length || 1024,
              model: "mistral-embed", totalEmbeddings: embeddings.length } });

    // ── STEP 4: Optional reset ─────────────────────────────
    if (resetBeforeIngest) {
      emit("step", { step: 4, label: "Resetting index", status: "running" });
      await resetIndex();
      emit("step", { step: 4, label: "Resetting index", status: "done" });
    }

    // ── STEP 5: Upsert to Pinecone ─────────────────────────
    emit("step", { step: 5, label: "Upserting to Pinecone", status: "running",
      data: { totalVectors: chunks.length } });

    await upsertChunks(chunks, embeddings, null, (progress) => {
      emit("progress", { step: 5, ...progress });
    });

    // ── STEP 6: Final index stats ──────────────────────────
    const indexStats = await getIndexStats();
    emit("step", { step: 5, label: "Upserting to Pinecone", status: "done",
      data: { indexStats } });

    emit("done", {
      totalRows:    rows.length,
      totalChunks:  chunks.length,
      dimensions:   embeddings[0]?.length || 1024,
      chunkSize,
      chunkOverlap,
      strategy,
      indexStats,
      stats,
    });

    res.end();
  } catch (err) {
    console.error("Ingest error:", err);
    res.write(`data: ${JSON.stringify({ event: "error", message: err.message })}\n\n`);
    res.end();
  }
});

// ── GET /api/ingest/stats ───────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const stats = await getIndexStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/ingest/reset ────────────────────────────────
router.delete("/reset", async (req, res) => {
  try {
    await resetIndex();
    res.json({ success: true, message: "Index cleared" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
