/**
 * Chunker Utility
 * Converts parsed CSV/Excel rows into overlapping text chunks
 * with full metadata for visualization in the UI
 */

/**
 * Convert a row object to a text string
 */
function rowToText(row, columns) {
  return columns
    .map((col) => `${col}: ${row[col] ?? ""}`)
    .join(" | ");
}

/**
 * Naive token estimator (1 token ≈ 4 characters)
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Main chunking function
 * @param {Array}  rows        - Array of row objects from CSV/Excel
 * @param {Array}  columns     - Column names
 * @param {Object} options     - { chunkSize, chunkOverlap, strategy }
 * @returns {Array}            - Array of chunk objects
 */
export function chunkRows(rows, columns, options = {}) {
  const {
    chunkSize    = 300,   // tokens
    chunkOverlap = 50,    // tokens
    strategy     = "sliding-window",
  } = options;

  const chunks   = [];
  let   chunkId  = 0;

  if (strategy === "row-based") {
    // One chunk per row
    rows.forEach((row, idx) => {
      const text   = rowToText(row, columns);
      const tokens = estimateTokens(text);
      chunks.push({
        chunkId:      `chunk_${String(chunkId++).padStart(4, "0")}`,
        content:      text,
        tokens,
        sourceRows:   [idx + 1],
        overlapTokens: 0,
        strategy:     "row-based",
        metadata: {
          rowIndex: idx,
          ...extractTestCaseMetadata(row),
        },
      });
    });
    return chunks;
  }

  // Sliding window — accumulate rows until chunkSize is reached
  let   buffer       = [];
  let   bufferTokens = 0;
  let   startRow     = 0;

  const flushBuffer = (overlapBuffer = []) => {
    if (buffer.length === 0) return;

    const content      = buffer.map((r) => rowToText(r, columns)).join("\n");
    const tokens       = estimateTokens(content);
    const overlapText  = overlapBuffer.map((r) => rowToText(r, columns)).join("\n");
    const overlapToks  = estimateTokens(overlapText);

    chunks.push({
      chunkId:       `chunk_${String(chunkId++).padStart(4, "0")}`,
      content,
      tokens,
      sourceRows:    [startRow + 1, startRow + buffer.length],
      overlapTokens: overlapToks,
      overlapContent: overlapText,
      strategy:      "sliding-window",
      metadata: {
        startRow,
        endRow: startRow + buffer.length - 1,
        rowCount: buffer.length,
        ...extractTestCaseMetadata(buffer[0]),
      },
    });
  };

  let overlapRows = [];

  for (let i = 0; i < rows.length; i++) {
    const rowText   = rowToText(rows[i], columns);
    const rowTokens = estimateTokens(rowText);

    if (bufferTokens + rowTokens > chunkSize && buffer.length > 0) {
      flushBuffer(overlapRows);

      // Calculate overlap — keep last N tokens worth of rows
      overlapRows  = [];
      let overlapT = 0;
      for (let j = buffer.length - 1; j >= 0; j--) {
        const t = estimateTokens(rowToText(buffer[j], columns));
        if (overlapT + t > chunkOverlap) break;
        overlapRows.unshift(buffer[j]);
        overlapT += t;
      }

      startRow     = i - overlapRows.length;
      buffer       = [...overlapRows];
      bufferTokens = overlapRows.reduce(
        (acc, r) => acc + estimateTokens(rowToText(r, columns)), 0
      );
    }

    buffer.push(rows[i]);
    bufferTokens += rowTokens;
  }

  if (buffer.length > 0) flushBuffer(overlapRows);

  return chunks;
}

/**
 * Extract common QA test case metadata fields from a row
 */
function extractTestCaseMetadata(row = {}) {
  return {
    testCaseId: row["Test Case ID"] || row["test_case_id"] || row["ID"] || "",
    module:     row["Module"]       || row["module"]       || "",
    priority:   row["Priority"]     || row["priority"]     || "",
    testType:   row["Test Type"]    || row["test_type"]    || "",
    jiraId:     row["Jira ID"]      || row["jira_id"]      || "",
    title:      row["Title"]        || row["title"]        || "",
  };
}

/**
 * Generate chunk statistics summary for UI display
 */
export function getChunkStats(chunks) {
  const tokenCounts   = chunks.map((c) => c.tokens);
  const overlapCounts = chunks.map((c) => c.overlapTokens || 0);
  return {
    totalChunks:     chunks.length,
    avgTokens:       chunks.length ? Math.round(tokenCounts.reduce((a, b) => a + b, 0) / chunks.length) : 0,
    minTokens:       chunks.length ? Math.min(...tokenCounts) : 0,
    maxTokens:       chunks.length ? Math.max(...tokenCounts) : 0,
    avgOverlap:      chunks.length ? Math.round(overlapCounts.reduce((a, b) => a + b, 0) / chunks.length) : 0,
    totalTokens:     chunks.length ? tokenCounts.reduce((a, b) => a + b, 0) : 0,
    strategy:        chunks[0]?.strategy || "unknown",
  };
}
