# Jira Test Case Generator

Build a full-stack web app that connects to Jira, fetches a ticket's user story by ID, and auto-generates a minimum of 5 structured test cases using a configurable test template. Output must be copy-ready and exportable.

## Tech Stack

- **Frontend:** React (Vite + Tailwind CSS)
- **Backend:** Python (FastAPI)
- **Jira client:** REST API v3 via `atlassian-python-api` or raw `httpx`
- **LLM:** Groq API, OpenRouter API, Gemini API and Ollama (configurable)

## Core Flow

1. User enters Jira credentials + Jira ID (e.g., `PROJ-123`) in the dashboard.
2. Backend authenticates and fetches the issue's **summary, description, acceptance criteria, issue type, priority, and linked components**.
3. Parsed user story + selected test template are sent to the LLM with a structured system prompt.
4. LLM returns **≥5 test cases** in a strict JSON schema.
5. Frontend renders test cases in an editable table with copy and export actions.

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

## ✨ New: Input Area Enhancements (near the dialogue box)

Two new action buttons must be placed **adjacent to the Jira ID input field**, forming a unified input bar:

### 📤 Export to Excel Button

- Positioned beside the input/dialogue box area for quick access.
- Exports all currently generated test cases to a formatted `.xlsx` file using a library such as `openpyxl` (backend) or `SheetJS/xlsx` (frontend).
- The Excel sheet must include **auto-mapped column headers** derived directly from the test case schema fields:

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

- Apply **header row styling**: bold, colored background (configurable brand color), auto-fit column widths.
- Each test step rendered on a new line within its cell (wrap text enabled).
- Sheet name defaults to the Jira ID (e.g., `PROJ-123`).
- File name format: `{JIRA_ID}_test_cases_{YYYY-MM-DD}.xlsx`.

### 📥 Import Document Button

- Positioned beside the Export button, near the input dialogue box.
- Opens a **file picker** supporting: `.pdf`, `.docx`, `.txt`, `.md` formats.
- On file selection, the document is uploaded to the backend (`POST /api/documents/upload`).
- Backend extracts and parses text content from the document (use `pdfplumber` for PDF, `python-docx` for DOCX).
- Extracted content is treated as the **requirement source** — exactly like a fetched Jira story — and passed to the LLM for test case generation.
- A **preview card** displays the extracted requirement text before generation so the user can verify accuracy.
- Works independently of Jira credentials — no Jira connection required when using document import.
- Support multi-page documents; truncate gracefully at token limits with a visible warning.

---

## New Backend Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jira/test-connection` | Validate Jira credentials |
| POST | `/api/jira/fetch-issue` | Return parsed Jira issue |
| POST | `/api/testcases/generate` | Return generated test cases |
| POST | `/api/testcases/export` | Return `.md`, `.csv`, or `.xlsx` blob |
| POST | `/api/documents/upload` | Accept doc/pdf/txt, extract + return parsed text |

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
- Clear error handling: invalid Jira ID, auth failure, empty description, LLM timeout, rate limit, unsupported file type, oversized document.
- Responsive layout for screens ≥1280px.
- Log generation latency and token usage.
- `.env.example` with all required keys.
- Uploaded documents held in memory per request only — never written to disk permanently.

---

## Deliverables

1. `/backend` — FastAPI app, `Dockerfile`, `requirements.txt`, `.env.example`
2. `/frontend` — React app with Tailwind, production build
3. `README.md` — setup, env vars, run commands, architecture diagram
4. Sample template files in `/templates`

---

## Open Questions to Confirm Before Building

1. **LLM provider** — Claude, OpenAI, Groq, OpenRouter, or local Ollama?
2. **Persistence** — store generated cases in SQLite/Postgres, or stateless per session?
3. **Write-back to Jira/Xray** — auto-create test issues, or copy-paste only?
4. **Multi-user** — single dev tool or team-shared with auth?
5. **Excel styling** — use a default blue header theme or match a custom brand color?
6. **Document size limit** — what is the max file size allowed for import (suggested default: 10MB)?
7. **Multi-document import** — should users be able to upload multiple docs and merge them as a single requirement source?

---
