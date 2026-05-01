# Jira Test Case Generator — Full Specification v3

Build a full-stack web app that connects to Jira, fetches a ticket's user story by ID, and auto-generates a minimum of 5 structured test cases using a configurable test template. Output must be copy-ready and exportable.

---

## Tech Stack

- **Frontend:** React (Vite + Tailwind CSS)
- **Backend:** Python (FastAPI)
- **Jira client:** REST API v3 via `atlassian-python-api` or raw `httpx`
- **LLM:** Groq API, OpenRouter API, Gemini API, and Ollama (configurable via env var `LLM_PROVIDER`)

---

## Core Flow

1. User enters Jira credentials + Jira ID (e.g., `PROJ-123`) in the dashboard.
2. Backend authenticates and fetches the issue's **summary, description, acceptance criteria, issue type, priority, and linked components**.
3. Parsed user story + selected test template are sent to the LLM with a structured system prompt.
4. LLM returns **≥5 test cases** in a strict JSON schema.
5. Frontend renders test cases in an editable table with copy and export actions.
6. Alternatively, user imports a document — backend parses it, extracts structured requirement text, and uses it as the LLM input source in place of a Jira ticket.

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
  - **Export as Excel** (`.xlsx` download) — see details below
- Validation: regenerate if fewer than 5 cases returned.

---

## ✨ Bottom Toolbar — Input Area Enhancements

Four action buttons sit in a **persistent bottom toolbar**, to the left of the input dialogue box:

```
[ 📎 Import Doc ]  [ ↓ Export MD ]  [ ↓ Export CSV ]  [ ↓ Export Excel ]  [...input field...]  [➤]
```

---

## 📎 Import Document Button — Full Specification

### Positioning & Appearance
- Leftmost button in the persistent bottom toolbar, beside the export buttons.
- Rendered as: `📎 Import Doc`
- On hover: tooltip reads *"Import any requirement document to generate test cases"*

---

### File Picker & Supported Formats

The file picker must accept **any document format** and apply intelligent parsing based on detected file type. Do not hardcode a whitelist at the OS picker level — attempt parsing for all files and return a graceful error only if extraction yields no usable text.

| Format | Parser | Notes |
|---|---|---|
| `.pdf` | `pdfplumber` + `PyMuPDF` fallback | Scanned PDFs → `pytesseract` OCR fallback |
| `.docx` | `python-docx` | Extract paragraphs, tables, headings, bullet lists |
| `.doc` | `textract` or `antiword` | Legacy Word format support |
| `.txt` | Native Python `open()` | UTF-8 with `chardet` encoding fallback |
| `.md` | `markdown-it-py` or raw text | Strip markdown syntax, preserve structure |
| `.xlsx` / `.xls` | `openpyxl` / `xlrd` | Flatten sheet content row by row |
| `.csv` | `pandas` | Treat rows as structured requirements |
| `.pptx` | `python-pptx` | Extract slide titles, body text, speaker notes |
| `.html` / `.htm` | `BeautifulSoup4` | Strip tags, extract semantic text blocks |
| `.rtf` | `striprtf` | Strip RTF control codes |
| `.odt` | `odfpy` | OpenDocument text extraction |
| `.epub` | `ebooklib` | Chapter-by-chapter extraction |
| Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.tiff`) | `pytesseract` OCR | Extract printed/handwritten text from screenshots or scanned docs |

> 🔧 Backend must use a **`DocumentParserRegistry` pattern** — each format maps to a dedicated extractor class. A `GenericTextParser` acts as the final fallback. New formats can be added without touching core logic.

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

Beyond raw text extraction, apply **structure-aware parsing**:

- **Headings & sections** → Preserved as labelled blocks (e.g., `## Acceptance Criteria`) so the LLM can weight them appropriately.
- **Tables** → Converted to clean markdown-style table strings before passing to LLM.
- **Bullet & numbered lists** → Preserved as structured lists, not collapsed into paragraphs.
- **Bold / italic emphasis** → Formatting stripped, text retained.
- **Headers + footers** → Detected and excluded from requirement content (configurable via env).
- **Page numbers, watermarks, metadata blobs** → Automatically stripped.
- **Multi-column PDF layouts** → Columns stitched in reading order using bounding box detection.
- **Scanned / image-based PDFs** → Auto-detected (no selectable text layer); OCR applied with visible banner: *"⚠️ Scanned document detected — OCR applied. Review extracted text for accuracy."*
- **Mixed content DOCX** (embedded images of diagrams) → Extract all text; skip non-text assets silently; log skipped elements.
- **Encoding detection** → Use `chardet`; never assume UTF-8 blindly.
- **Language detection** → Use `langdetect`; if non-English, surface warning: *"Document appears to be in [language]. Generation quality may vary."* Do not block generation.

---

### Upload Flow

```
User clicks Import Doc
        ↓
File picker opens (no format restriction at OS level)
        ↓
File selected → show upload chip immediately with spinner
        ↓
POST /api/documents/upload  (multipart/form-data)
        ↓
Backend: detect MIME + extension → select parser from registry → extract → clean → chunk
        ↓
Return METADATA ONLY to frontend:
(name, size, page/sheet count, detected format, word count, truncation warning)
        ↓
Chip updates: spinner → ✅ file name + metadata  [✕ remove]
        ↓
Extracted text held server-side in short-lived session store
        ↓
User clicks Generate → session text passed directly to LLM pipeline
```

> ⚠️ `/api/documents/upload` must return **only file metadata** to the frontend — never raw extracted text. Raw text stays server-side and is passed directly to the LLM on generate.

---

### Frontend File Chip (Post-Upload Display)

Once uploaded, a **file attachment chip** appears inside/above the input bar. **The dialogue/text input box must remain empty and editable** — raw document content must never be dumped into it.

**Standard parsed file:**
```
┌──────────────────────────────────────────────────────┐
│  📄 PRD_Login_Dashboard.pdf       2.4 MB   14 pg  ✕  │
│  ✅ Parsed · 3,240 words · Requirement source: doc   │
└──────────────────────────────────────────────────────┘
[ type additional context or Jira ID...               ] [➤]
```

**OCR-processed file:**
```
┌──────────────────────────────────────────────────────┐
│  🖼️ requirements_scan.png         1.1 MB          ✕  │
│  ⚠️ OCR applied · 980 words · Review before generate │
└──────────────────────────────────────────────────────┘
```

- File type icon is **color-coded** by format (PDF red, DOCX blue, image teal, etc.)
- File name truncated with tooltip showing full name on hover.
- A subtle label reads: `📎 Requirement source: document`

---

### Preview Card (Expandable, Editable)

- An optional **"Preview Extracted Content"** toggle appears above the output table after upload.
- Expands to show the cleaned, structured text that will be sent to the LLM — with section headings and bullet lists preserved.
- User can **manually edit** the preview text before hitting Generate (critical for correcting OCR errors).
- Edits in the preview card override the original extracted text as the final LLM input.

---

### Token Limit & Chunking

- If extracted text exceeds the configured LLM context window, the backend must:
  - **Chunk** by logical sections (respect heading boundaries, never mid-sentence).
  - Generate test cases **per chunk**, then **deduplicate and merge** results.
  - Show warning banner: *"⚠️ Document too large for single pass. Generated from [N] chunks. Some sections may have lower coverage."*
- Env var `MAX_DOC_TOKENS` controls the cutoff (default: `8000`).

---

### Jira Independence

- Works fully without Jira credentials.
- `linked_jira_id` in generated test cases defaults to `DOC_IMPORT` unless user types a Jira ID alongside the chip.
- If both a document **and** a Jira ID are provided, show a conflict resolution prompt:
  > *"Both a document and a Jira ID are provided. Which should be the primary requirement source?"*
  > `[ Use Document ]  [ Use Jira ID ]  [ Merge Both ]`

---

### Error States

| Condition | UI Behavior |
|---|---|
| File too large (>10MB) | Chip red: *"File exceeds 10MB limit"* |
| Parsing yields no text | Chip error: *"Could not extract text. Try a different format."* |
| OCR confidence low | Warning chip: *"Low OCR confidence — preview and edit before generating"* |
| Upload network failure | Chip: *"Upload failed"* + retry icon |
| Unsupported binary (`.exe`, etc.) | Immediate rejection: *"This file type cannot be parsed for requirements"* |
| Encoding undetectable | UTF-8 fallback + warning: *"Encoding unclear — some characters may be missing"* |
| Non-English document | Warning banner (non-blocking): *"Document appears to be in [language]. Generation quality may vary."* |
| Truncation applied | Info banner: *"Document truncated at [X] words to fit model context window."* |

---

## 📤 Export to Excel Button — Full Specification

- Exports all generated test cases to a formatted `.xlsx` file via `openpyxl` (backend) or `SheetJS` (frontend).
- **Auto-mapped column headers** from test case schema:

| Column Header | Field |
|---|---|
| Test Case ID | `id` |
| Title | `title` |
| Type | `type` |
| Priority | `priority` |
| Preconditions | `preconditions` |
| Test Steps | `steps` (newline-joined within cell) |
| Test Data | `test_data` |
| Expected Result | `expected_result` |
| Linked Jira ID | `linked_jira_id` |

- Header row: **bold, colored background** (configurable via `EXCEL_HEADER_COLOR` env var, default blue), auto-fit column widths, text wrap enabled.
- Sheet name: Jira ID (e.g., `PROJ-123`) or document name (e.g., `PRD_Login`) when source is a document.
- File name format: `{source}_test_cases_{YYYY-MM-DD}.xlsx`

---

## Backend Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jira/test-connection` | Validate Jira credentials |
| POST | `/api/jira/fetch-issue` | Return parsed Jira issue |
| POST | `/api/testcases/generate` | Return generated test cases |
| POST | `/api/testcases/export` | Return `.md`, `.csv`, or `.xlsx` blob |
| POST | `/api/documents/upload` | Accept file, parse server-side, return metadata only |

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

Templates are YAML files defining coverage categories, depth, and tone. Ship one default; allow custom upload.

---

## Non-Functional Requirements

- API token held in session only — never persisted server-side.
- Uploaded documents held in memory per request only — never written to disk permanently.
- Clear error handling across: invalid Jira ID, auth failure, empty description, LLM timeout, rate limit, unsupported file type, oversized document, OCR failure, encoding errors.
- Responsive layout for screens ≥1280px.
- Log generation latency and token usage per request.
- `.env.example` with all required keys documented.

---

## Environment Variables

```env
LLM_PROVIDER=groq                  # groq | openrouter | gemini | ollama
LLM_API_KEY=your_key_here
MAX_DOC_TOKENS=8000
MAX_UPLOAD_SIZE_MB=10
EXCEL_HEADER_COLOR=4472C4          # Hex color for Excel header row
```

---

## Deliverables

1. `/backend` — FastAPI app, `Dockerfile`, `requirements.txt`, `.env.example`
2. `/frontend` — React app with Tailwind, production build
3. `README.md` — setup, env vars, run commands, architecture diagram
4. `/templates` — sample YAML template files

---

## Open Questions to Confirm Before Building

1. **LLM provider** — Groq, OpenRouter, Gemini, or local Ollama? (all supported; which is default?)
2. **Persistence** — SQLite/Postgres for generated cases, or stateless per session?
3. **Write-back to Jira/Xray** — auto-create test issues, or copy-paste only?
4. **Multi-user** — single dev tool or team-shared with auth?
5. **Excel styling** — default blue header or custom brand color?
6. **Document size limit** — confirm 10MB default or override?
7. **Multi-document import** — merge multiple docs as a single requirement source?
8. **Preview card** — should extracted content be editable before generation, or read-only?

--