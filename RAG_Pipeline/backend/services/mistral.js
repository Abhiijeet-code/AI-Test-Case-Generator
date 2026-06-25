/**
 * Mistral Embed Service
 * Generates 1024-dimensional embeddings using mistral-embed model
 */

const MISTRAL_API_URL = "https://api.mistral.ai/v1/embeddings";
const MODEL           = "mistral-embed";
const BATCH_SIZE      = 32; // Mistral recommended batch size

/**
 * Embed a single text string
 */
export async function embedText(text, apiKey) {
  const key = apiKey || process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY not configured");
  const start = Date.now();

  const res = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({ model: MODEL, input: [text] }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Mistral API error: ${err.message || res.statusText}`);
  }

  const data    = await res.json();
  const latency = Date.now() - start;

  return {
    embedding:  data.data[0].embedding,
    dimensions: data.data[0].embedding.length,
    model:      MODEL,
    latencyMs:  latency,
    tokens:     data.usage?.total_tokens || 0,
  };
}

/**
 * Embed multiple texts in batches
 * Returns array of embedding results with progress callbacks
 */
export async function embedBatch(texts, apiKey, onProgress) {
  const key     = apiKey || process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY not configured");
  const results = [];
  const total   = Math.ceil(texts.length / BATCH_SIZE);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batchNum  = Math.floor(i / BATCH_SIZE) + 1;
    const batch     = texts.slice(i, i + BATCH_SIZE);
    const start     = Date.now();

    const res = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Mistral batch ${batchNum} error: ${err.message || res.statusText}`);
    }

    const data    = await res.json();
    const latency = Date.now() - start;

    data.data.forEach((item) => results.push(item.embedding));

    if (onProgress) {
      onProgress({
        batchNum,
        totalBatches: total,
        processed:    Math.min(i + BATCH_SIZE, texts.length),
        total:        texts.length,
        latencyMs:    latency,
        tokensUsed:   data.usage?.total_tokens || 0,
      });
    }
  }

  return results;
}
