import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import ingestRouter from "./routes/ingest.js";
import retrieveRouter from "./routes/retrieve.js";
import chatRouter from "./routes/chat.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ─────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ─── Routes ─────────────────────────────────────────────────
app.use("/api/ingest", ingestRouter);
app.use("/api/retrieve", retrieveRouter);
app.use("/api/chat", chatRouter);

// ─── Health Check ───────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  const services = {
    mistral:  !!process.env.MISTRAL_API_KEY,
    pinecone: !!process.env.PINECONE_API_KEY,
    cohere:   !!process.env.COHERE_API_KEY,
    groq:     !!process.env.GROQ_API_KEY,
  };
  res.json({
    status: "ok",
    services,
    allConnected: Object.values(services).every(Boolean),
    timestamp: new Date().toISOString(),
  });
});

// ─── Global Error Handler ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

app.listen(PORT, () => {
  console.log(`✅ RAG Backend running at http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
});
