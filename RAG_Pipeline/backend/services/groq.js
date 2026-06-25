/**
 * Groq LLM Service
 * Supports streaming responses with multiple open-source models
 */

import Groq from "groq-sdk";

export const AVAILABLE_MODELS = [
  { id: "llama-3.1-8b-instant",   label: "LLaMA 3.1 8B",      speed: "fastest"  },
  { id: "llama-3.3-70b-versatile",label: "LLaMA 3.3 70B",     speed: "balanced" },
  { id: "mixtral-8x7b-32768",     label: "Mixtral 8x7B",      speed: "balanced" },
  { id: "gemma2-9b-it",           label: "Gemma 2 9B",        speed: "balanced" },
];

const DEFAULT_MODEL = "llama-3.1-8b-instant";

/**
 * Build prompt from reranked context chunks
 */
function buildPrompt(query, chunks) {
  const context = chunks
    .map((c, i) => `[Context ${i + 1}]\n${c.content || c.preview}`)
    .join("\n\n");

  return `You are a Senior QA Engineer assistant. Use ONLY the context below to answer.
If the context doesn't contain enough information, say so clearly.

CONTEXT:
${context}

USER QUERY:
${query}

Respond in a structured, professional QA format. If asked to generate a test case, 
use the standard schema: Test Case ID, Module, Title, Preconditions, Steps, 
Test Data, Expected Result, Priority, Test Type.`;
}

/**
 * Non-streaming completion — returns full response with metrics
 */
export async function generateCompletion(query, chunks, options = {}) {
  const {
    model      = DEFAULT_MODEL,
    maxTokens  = 1024,
    temperature = 0.2,
    apiKey,
  } = options;

  const key   = apiKey || process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not configured");
  const groq  = new Groq({ apiKey: key });
  const start = Date.now();

  const prompt = buildPrompt(query, chunks);

  const completion = await groq.chat.completions.create({
    model,
    max_tokens:  maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });

  const latency = Date.now() - start;
  const choice  = completion.choices[0];

  return {
    answer:          choice.message.content,
    model,
    promptTokens:    completion.usage?.prompt_tokens     || 0,
    completionTokens: completion.usage?.completion_tokens || 0,
    totalTokens:     completion.usage?.total_tokens       || 0,
    latencyMs:       latency,
    contextChunks:   chunks.length,
    finishReason:    choice.finish_reason,
  };
}

/**
 * Streaming completion — pipes to Express response (SSE)
 */
export async function streamCompletion(query, chunks, options = {}, res) {
  const {
    model      = DEFAULT_MODEL,
    maxTokens  = 1024,
    temperature = 0.2,
    apiKey,
  } = options;

  const key   = apiKey || process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not configured");
  const groq  = new Groq({ apiKey: key });
  const start = Date.now();
  const prompt = buildPrompt(query, chunks);

  const stream = await groq.chat.completions.create({
    model,
    max_tokens:  maxTokens,
    temperature,
    stream:      true,
    messages: [{ role: "user", content: prompt }],
  });

  let fullText     = "";
  let promptTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || "";
    if (delta) {
      fullText += delta;
      res.write(`data: ${JSON.stringify({ type: "token", content: delta })}\n\n`);
    }
    if (chunk.usage) promptTokens = chunk.usage.prompt_tokens;
  }

  // Send final metrics event
  res.write(`data: ${JSON.stringify({
    type:             "done",
    model,
    latencyMs:        Date.now() - start,
    promptTokens,
    completionTokens: Math.ceil(fullText.length / 4),
    totalTokens:      promptTokens + Math.ceil(fullText.length / 4),
    contextChunks:    chunks.length,
  })}\n\n`);

  res.end();
}
