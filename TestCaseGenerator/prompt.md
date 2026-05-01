# Jira Test Case Generator — Full Specification v4

Build a full-stack web app that connects to Jira, fetches a ticket's user story by ID, and auto-generates a minimum of 5 structured test cases using a configurable test template. Output must be copy-ready, exportable, and semantically searchable via a local vector database.

---

## Tech Stack

- **Frontend:** React (Vite + Tailwind CSS)
- **Backend:** Python (FastAPI)
- **Jira client:** REST API v3 via `atlassian-python-api` or raw `httpx`
- **LLM:** Groq API, OpenRouter API, Gemini API, and Ollama (configurable via env var `LLM_PROVIDER`)
- **Vector DB:** FAISS (Facebook AI Similarity Search) — local, file-based, no external service required
- **Embeddings:** `sentence-transformers` (default: `all-MiniLM-L6-v2`) or OpenAI embeddings (configurable)

---

## Core Flow

1. User enters Jira credentials + Jira ID (e.g., `PROJ-123`) in the dashboard.
2. Backend authenticates and fetches the issue's **summary, description, acceptance criteria, issue type, priority, and linked components**.
3. Parsed user story + selected test template are sent to the LLM with a structured system prompt.
4. LLM returns **≥10 test cases** in a strict JSON schema.
5. **Generated test cases are embedded and stored in FAISS** for semantic search and deduplication.
6. Frontend renders test cases in an editable table with copy and export actions.
7. Alternatively, user imports a document — backend parses it, extracts structured requirement text, **chunks and embeds it into FAISS**, and uses it as the LLM input source in place of a Jira ticket.

---

## Dashboard Requirements

- **Connection panel:** Jira base URL, email, API token (masked). "Test Connection" button with clear success/error feedback.
- **Input panel:** Jira ID field, template selector (Functional / Regression / Smoke / Edge / Security / Custom), "Generate" button with loading + progress states.
- **Context card:** Displays the parsed user story and acceptance criteria so the user can verify what was pulled before generation.
- **Output panel:**
  - Editable table showing all generated test cases
  - **Copy to Clipboard** (TSV format for direct paste into Jira/Xray/TestRail)
  - **Export as Markdown** (`.md` download)
  - **Export as CSV** (`.csv` download)
  - **Export as Excel** (`.xlsx` download)
- Validation: regenerate if fewer than 5 cases returned.

---

## ✨ Bottom Toolbar — Input Area

```
[ 📎 Import Doc ]  [ ↓ Export MD ]  [ ↓ Export CSV ]  [ ↓ Export Excel ]  [...input field...]  [➤]
```

---

## 🧠 FAISS Vector Database — Full Specification

### Purpose & Role

FAISS serves three distinct roles in this system:

1. **Document chunk retrieval (RAG)** — Imported documents are chunked and embedded; at generation time, only the most relevant chunks are retrieved and sent to the LLM, dramatically improving quality for large documents.
2. **Test case deduplication** — Before storing new test cases, FAISS similarity search detects near-duplicates against existing cases and flags or merges them.
3. **Semantic search** — Users can search across all previously generated test cases using natural language queries.

---

### FAISS Index Architecture

```
/faiss_store/
├── documents/
│   ├── {session_id}.index       # Per-session document chunk index
│   └── {session_id}.meta.json   # Chunk metadata (source, page, section)
├── testcases/
│   ├── global.index             # All generated test cases (persistent)
│   └── global.meta.json        # Test case metadata
└── config.json                  # Index config (dimension, metric, model)
```

- **Index type:** `IndexFlatIP` (inner product / cosine similarity) for accuracy; upgrade to `IndexIVFFlat` when index exceeds 10,000 vectors for speed.
- **Embedding dimension:** 384 (MiniLM default) — configurable via `EMBEDDING_DIM` env var.
- **Distance metric:** Cosine similarity (normalize vectors before indexing).
- **Persistence:** `faiss.write_index()` / `faiss.read_index()` — indexes survive server restarts.

---

### Embedding Pipeline

```python
@dataclass
class EmbeddingConfig:
    model_name: str = "all-MiniLM-L6-v2"   # or "text-embedding-ada-002" for OpenAI
    provider: str = "sentence_transformers"  # sentence_transformers | openai
    dimension: int = 384
    normalize: bool = True                   # Required for cosine similarity
    batch_size: int = 64
```

**Supported embedding providers:**

| Provider | Model | Dimension | Notes |
|---|---|---|---|
| `sentence_transformers` | `all-MiniLM-L6-v2` | 384 | Default, fully local, no API key |
| `sentence_transformers` | `all-mpnet-base-v2` | 768 | Higher quality, slower |
| `openai` | `text-embedding-ada-002` | 1536 | Requires `OPENAI_API_KEY` |
| `openai` | `text-embedding-3-small` | 1536 | Cheaper OpenAI option |

---

### Document RAG Flow (Import → FAISS → LLM)

```
Document uploaded & parsed
        ↓
Text split into chunks (512 tokens, 50-token overlap, respect section boundaries)
        ↓
Each chunk embedded via configured embedding model
        ↓
Chunks + metadata stored in per-session FAISS index
        ↓
User clicks Generate
        ↓
Query = Jira ID context OR user-typed context OR "generate test cases"
        ↓
FAISS similarity search → top-K most relevant chunks retrieved (default K=5)
        ↓
Retrieved chunks assembled into LLM context window
        ↓
LLM generates test cases from focused, relevant content only
        ↓
Generated test cases embedded + stored in global test case FAISS index
```

**Chunking strategy:**
- Respect heading boundaries — never split mid-section.
- Chunk size: `512` tokens (configurable via `CHUNK_SIZE` env var).
- Overlap: `50` tokens (configurable via `CHUNK_OVERLAP` env var).
- Each chunk stores metadata: `{source_file, page_number, section_heading, char_offset}`.

---

### Test Case Deduplication via FAISS

Before saving any newly generated test case to the global index:

1. Embed the new test case title + steps.
2. Run FAISS similarity search against the global test case index.
3. If cosine similarity > `DEDUP_THRESHOLD` (default: `0.92`), flag as a near-duplicate.
4. Surface to user:

```
┌─────────────────────────────────────────────────────┐
│  ⚠️ Possible Duplicate Detected                     │
│  "TC_014: Verify login with invalid password"       │
│  is 94% similar to existing:                        │
│  "TC_003: Login fails with wrong credentials"       │
│                                                     │
│  [ Keep Both ]  [ Merge ]  [ Discard New ]          │
└─────────────────────────────────────────────────────┘
```

---

### Semantic Search Panel

A **Search Test Cases** input appears above the output table when the global index contains at least 1 test case:

- User types a natural language query (e.g., *"login failure with wrong password"*)
- Backend embeds the query and runs FAISS top-K search.
- Returns ranked results with **similarity scores** displayed as percentage badges.
- Results link back to the Jira ID or document source they were generated from.
- Configurable `TOP_K_RESULTS` (default: `5`).

```
🔍 Search test cases...   [___________________________]

Results (3 found):
  ● TC_003  "Login fails with wrong credentials"        94% match  [PROJ-123]
  ● TC_017  "Verify lockout after 5 failed attempts"    81% match  [PROJ-456]
  ● TC_009  "Empty password field validation"           76% match  [DOC_IMPORT]
```

---

### FAISS Index Management Panel (Settings)

Accessible via the ⚙️ settings icon in the top-right corner:

| Control | Description |
|---|---|
| **Index stats** | Total vectors, index size on disk, embedding model in use |
| **Clear session index** | Wipe the current document's chunk index |
| **Clear global index** | Wipe all stored test case embeddings (with confirmation) |
| **Rebuild index** | Re-embed all stored test cases (useful after model change) |
| **Export index** | Download `global.index` + `global.meta.json` as a `.zip` |
| **Import index** | Upload a previously exported index to restore history |

---

### New Backend Endpoints (FAISS)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/vector/stats` | Return index size, vector count, model info |
| POST | `/api/vector/search` | Semantic search across global test case index |
| DELETE | `/api/vector/session/{session_id}` | Clear session document index |
| DELETE | `/api/vector/global` | Clear global test case index |
| POST | `/api/vector/rebuild` | Re-embed and rebuild global index |
| GET | `/api/vector/export` | Download index as zip |
| POST | `/api/vector/import` | Upload and restore index |

---

## 📎 Import Document Button — Full Specification

### Positioning & Appearance
- Leftmost button in the persistent bottom toolbar.
- Rendered as: `📎 Import Doc`
- On hover: tooltip reads *"Import any requirement document to generate test cases"*

---

### File Picker & Supported Formats

Accept **any document format**; apply intelligent parsing based on detected file type. No whitelist at OS picker level — graceful error only if extraction yields no usable text.

| Format | Parser | Notes |
|---|---|---|
| `.pdf` | `pdfplumber` + `PyMuPDF` fallback | Scanned PDFs → `pytesseract` OCR |
| `.docx` | `python-docx` | Paragraphs, tables, headings, bullets |
| `.doc` | `textract` or `antiword` | Legacy Word support |
| `.txt` | Native Python `open()` | `chardet` encoding fallback |
| `.md` | `markdown-it-py` or raw text | Preserve structure |
| `.xlsx` / `.xls` | `openpyxl` / `xlrd` | Flatten sheet row by row |
| `.csv` | `pandas` | Structured requirements rows |
| `.pptx` | `python-pptx` | Titles, body, speaker notes |
| `.html` / `.htm` | `BeautifulSoup4` | Semantic text blocks |
| `.rtf` | `striprtf` | Strip RTF control codes |
| `.odt` | `odfpy` | OpenDocument extraction |
| `.epub` | `ebooklib` | Chapter-by-chapter |
| Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.tiff`) | `pytesseract` OCR | Scanned/handwritten requirements |

> 🔧 **`DocumentParserRegistry` pattern** — each format maps to a dedicated extractor. `GenericTextParser` as final fallback.

```python
class BaseParser:
    def can_parse(self, mime_type: str, extension: str) -> bool: ...
    def extract(self, file_bytes: bytes, filename: str) -> ParsedDocument: ...

@dataclass
class ParsedDocument:
    raw_text: str
    sections: list[Section]
    word_count: int
    page_count: int
    detected_language: str
    ocr_applied: bool
    truncated: bool
    warnings: list[str]
```

---

### Intelligent Parsing Behavior

- **Headings & sections** → Preserved as labelled blocks for LLM weighting.
- **Tables** → Converted to markdown-style table strings.
- **Bullet & numbered lists** → Preserved as structured lists.
- **Bold / italic emphasis** → Formatting stripped, text retained.
- **Headers + footers** → Excluded (configurable via env).
- **Page numbers, watermarks, metadata** → Auto-stripped.
- **Multi-column PDF layouts** → Stitched in reading order via bounding box detection.
- **Scanned PDFs** → OCR applied with banner: *"⚠️ Scanned document — OCR applied."*
- **Mixed DOCX content** → Text extracted; embedded images skipped and logged.
- **Encoding** → `chardet` detection; no UTF-8 assumption.
- **Language** → `langdetect`; non-English warning shown, generation not blocked.

---

### Upload & FAISS Indexing Flow

```
User clicks Import Doc
        ↓
File picker opens (no OS-level format restriction)
        ↓
File selected → upload chip shown with spinner
        ↓
POST /api/documents/upload  (multipart/form-data)
        ↓
Backend: detect MIME + extension → parser registry → extract → clean
        ↓
Text chunked (512 tokens, 50 overlap) → each chunk embedded
        ↓
Chunks stored in per-session FAISS index with metadata
        ↓
Return METADATA ONLY to frontend:
(name, size, page count, format, word count, chunk count, warnings)
        ↓
Chip: spinner → ✅ file name + metadata  [✕ remove]
        ↓
User clicks Generate → FAISS retrieves top-K relevant chunks → LLM pipeline
```

---

### Frontend File Chip

```
┌──────────────────────────────────────────────────────────┐
│  📄 PRD_Login_Dashboard.pdf    2.4 MB  14 pg  42 chunks ✕│
│  ✅ Parsed · 3,240 words · Indexed in FAISS              │
└──────────────────────────────────────────────────────────┘
[ type additional context or Jira ID...                   ] [➤]
```

OCR file:
```
┌──────────────────────────────────────────────────────────┐
│  🖼️ requirements_scan.png      1.1 MB         18 chunks ✕│
│  ⚠️ OCR applied · 980 words · Review before generate     │
└──────────────────────────────────────────────────────────┘
```

---

### Preview Card (Expandable, Editable)

- Toggle: **"Preview Extracted Content"** — appears after upload.
- Shows cleaned, structured text with section headings and bullets preserved.
- User can manually edit before Generate — edits override original extracted text and are re-embedded into FAISS before generation.

---

### Token Limit & Chunking

- FAISS-powered RAG eliminates most token limit issues — only top-K relevant chunks are sent to LLM.
- If a single chunk exceeds context, split further with warning.
- Env var `MAX_DOC_TOKENS` still applies as a hard cap (default: `8000`).
- Warning banner: *"⚠️ Document too large for single pass — FAISS RAG active. Generating from top relevant sections."*

---

### Jira Independence

- Works fully without Jira credentials.
- `linked_jira_id` defaults to `DOC_IMPORT` unless user types a Jira ID alongside the chip.
- Conflict prompt when both provided:
  > `[ Use Document ]  [ Use Jira ID ]  [ Merge Both ]`

---

### Error States

| Condition | UI Behavior |
|---|---|
| File too large (>10MB) | Chip red: *"File exceeds 10MB limit"* |
| Parsing yields no text | *"Could not extract text. Try a different format."* |
| OCR confidence low | *"Low OCR confidence — preview and edit before generating"* |
| FAISS indexing failure | *"Indexing failed — falling back to full-text mode"* |
| Upload network failure | *"Upload failed"* + retry icon |
| Unsupported binary | *"This file type cannot be parsed for requirements"* |
| Encoding undetectable | UTF-8 fallback + warning |
| Non-English document | Non-blocking warning banner |
| Truncation applied | Info banner with word count |

---

## 📤 Export to Excel — Full Specification

- Format: `.xlsx` via `openpyxl` (backend) or `SheetJS` (frontend).
- **Auto-mapped column headers:**

| Column Header | Field |
|---|---|
| Test Case ID | `id` |
| Title | `title` |
| Type | `type` |
| Priority | `priority` |
| Preconditions | `preconditions` |
| Test Steps | `steps` (newline-joined) |
| Test Data | `test_data` |
| Expected Result | `expected_result` |
| Linked Jira ID | `linked_jira_id` |

- Header: bold, colored background (`EXCEL_HEADER_COLOR` env, default blue), auto-fit widths, text wrap.
- Sheet name: Jira ID or document name.
- File name: `{source}_test_cases_{YYYY-MM-DD}.xlsx`

---

## Backend Endpoints — Complete

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jira/test-connection` | Validate Jira credentials |
| POST | `/api/jira/fetch-issue` | Return parsed Jira issue |
| POST | `/api/testcases/generate` | Generate + embed + store test cases |
| POST | `/api/testcases/export` | Return `.md`, `.csv`, or `.xlsx` blob |
| POST | `/api/documents/upload` | Parse file, chunk, embed into FAISS, return metadata |
| GET | `/api/vector/stats` | Index size, vector count, model info |
| POST | `/api/vector/search` | Semantic search across global test case index |
| DELETE | `/api/vector/session/{session_id}` | Clear session document index |
| DELETE | `/api/vector/global` | Clear global test case index |
| POST | `/api/vector/rebuild` | Re-embed and rebuild global index |
| GET | `/api/vector/export` | Download index as zip |
| POST | `/api/vector/import` | Upload and restore index |

---

## Test Case Schema (strict)

```json
{
  "id": "TC_001",
  "title": "string",
  "type": "Positive | Negative | Edge | Boundary | Security",
  "priority": "P0 | P1 | P2",
  "preconditions": "string",
  "steps": ["step 1", "step 2"],
  "test_data": "string",
  "expected_result": "string",
  "linked_jira_id": "PROJ-123"
}
```

---

## Template Format

YAML files defining coverage categories, depth, and tone. Ship one default; allow custom upload.

---

## Non-Functional Requirements

- API token held in session only — never persisted server-side.
- Uploaded documents held in memory per request — never written to disk permanently.
- FAISS indexes persisted to disk at `/faiss_store/` — survive server restarts.
- Clear error handling across all failure modes.
- Responsive layout for screens ≥1280px.
- Log generation latency, token usage, FAISS query time, and embedding time per request.
- `.env.example` with all required keys documented.

---

## Environment Variables

```env
# LLM
LLM_PROVIDER=groq                        # groq | openrouter | gemini | ollama
LLM_API_KEY=your_key_here

# Embeddings
EMBEDDING_PROVIDER=sentence_transformers  # sentence_transformers | openai
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIM=384
OPENAI_API_KEY=                          # Only if using OpenAI embeddings

# FAISS
FAISS_STORE_PATH=./faiss_store
DEDUP_THRESHOLD=0.92                     # Cosine similarity threshold for duplicate detection
TOP_K_RESULTS=5                          # Number of results for semantic search
CHUNK_SIZE=512                           # Tokens per document chunk
CHUNK_OVERLAP=50                         # Overlap between chunks

# Documents
MAX_DOC_TOKENS=8000
MAX_UPLOAD_SIZE_MB=10

# Export
EXCEL_HEADER_COLOR=4472C4               # Hex color for Excel header row
```

---

## Deliverables

1. `/backend` — FastAPI app, `Dockerfile`, `requirements.txt`, `.env.example`
2. `/frontend` — React app with Tailwind, production build
3. `/faiss_store` — Pre-initialized empty index structure with `config.json`
4. `README.md` — setup, env vars, run commands, architecture diagram (including FAISS RAG flow)
5. `/templates` — sample YAML template files

---

## Open Questions to Confirm Before Building

1. **LLM provider** — Groq, OpenRouter, Gemini, or Ollama? (which is default?)
2. **Embedding provider** — local `sentence-transformers` or OpenAI embeddings?
3. **Persistence** — SQLite/Postgres for test case metadata alongside FAISS, or FAISS metadata JSON only?
4. **Write-back to Jira/Xray** — auto-create test issues, or copy-paste only?
5. **Multi-user** — single dev tool or team-shared? (impacts FAISS index isolation strategy)
6. **Excel styling** — default blue header or custom brand color?
7. **Document size limit** — confirm 10MB default or override?
8. **Multi-document import** — merge multiple docs into a single session FAISS index?
9. **Preview card** — editable before generation, or read-only?
10. **FAISS index sharing** — should the global test case index be shared across users or isolated per user?
