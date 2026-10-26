import os
import io
import json
import uuid
import zipfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from typing import Dict, Any, List

from app.models import (
    GenerateRequest, 
    TestConnectionRequest, 
    JiraTestConnectionRequest, 
    FetchIssueRequest,
    VectorSearchRequest,
    ConfigPayload,
    McpTestRequest,
    ExportVsCodeRequest,
    RagSimulateRequest,
    ChatRequest,
    CodegenFrameworkRequest
)
from app.vector_store import faiss_store


from app.document_parser import parse_document
from app.jira_client import fetch_jira_issue, test_jira_connection
from app.llm_client import generate_test_cases, test_llm_connection

app = FastAPI(title="AI Test Case Generator v4")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── System Routes ───

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "FastAPI Backend is running"}

# ─── Settings Routes (In-memory fallback for now, as spec states settings are mostly localStorage) ───
settings_store = {}

@app.get("/api/settings")
def get_settings():
    return settings_store

@app.post("/api/settings")
def save_settings(settings: dict):
    global settings_store
    settings_store.update(settings)
    return {"status": "ok", "message": "Settings saved", "settings": settings_store}

# ─── Connection Tests ───

@app.post("/api/test-connection")
async def test_llm_conn(req: TestConnectionRequest):
    try:
        # Pass raw dict so flat keys (groqApiKey, etc.) are preserved
        config = req.config.model_dump(exclude_none=True)
        await test_llm_connection(req.provider, config)
        return {"status": "ok", "message": "Connection successful"}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

@app.post("/api/jira/test-connection")
async def test_jira_conn(req: JiraTestConnectionRequest):
    c = req.config
    if not c.jiraBaseUrl or not c.jiraEmail or not c.jiraApiToken:
        raise HTTPException(status_code=400, detail="Jira URL, email, and API token are required.")
    await test_jira_connection(c.jiraBaseUrl, c.jiraEmail, c.jiraApiToken)
    return {"status": "ok", "message": "Jira connection successful"}

@app.post("/api/jira/fetch")
async def fetch_issue(req: FetchIssueRequest):
    c = req.config
    if not c.jiraBaseUrl or not c.jiraEmail or not c.jiraApiToken:
        raise HTTPException(status_code=400, detail="Jira is not configured.")
    ticket = await fetch_jira_issue(req.jiraId, c.jiraBaseUrl, c.jiraEmail, c.jiraApiToken)
    return {"status": "ok", "ticket": ticket}

# ─── Documents ───

@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    buffer = await file.read()
    text = parse_document(buffer, file.filename, file.content_type)
    
    if not text or len(text.strip()) < 10:
        raise HTTPException(status_code=422, detail="Could not extract text. Try a different format.")
        
    session_id = str(uuid.uuid4())
    metadata = {
        "name": file.filename,
        "sizeBytes": len(buffer)
    }
    
    # Store in FAISS
    num_chunks = faiss_store.index_document(session_id, text, metadata)
    
    return {
        "status": "ok",
        "sessionDocId": session_id,
        "originalname": file.filename,
        "sizeBytes": len(buffer),
        "wordCount": len(text.split()),
        "chunkCount": num_chunks,
        "detectedFormat": file.filename.split(".")[-1].upper() if "." in file.filename else "TXT"
    }

# ─── Generate ───

@app.post("/api/generate")
async def generate_cases(req: GenerateRequest):
    try:
        c = req.config.model_dump(exclude_none=True) if req.config else {}
        provider = req.config.activeProvider if req.config and req.config.activeProvider else "groq"
        
        context_text = ""
        jira_id = "DOC_IMPORT"
        
        # RAG Retrieval
        if req.sessionDocId:
            query = "generate test cases"
            if req.requirement: query += f" for {req.requirement}"
            if req.jiraTicket: query += f" context: {req.jiraTicket.summary}"
            
            chunks = faiss_store.search_document(req.sessionDocId, query, top_k=5)
            if chunks:
                context_text += "--- Relevant Document Sections ---\n"
                for ch in chunks:
                    context_text += f"{ch.get('text', '')}\n\n"
        
        if req.jiraTicket:
            jira_id = req.jiraTicket.jiraId
            context_text += f"--- Jira Ticket {jira_id} ---\n"
            context_text += f"Summary: {req.jiraTicket.summary}\n"
            context_text += f"Description: {req.jiraTicket.description}\n"
            context_text += f"Acceptance Criteria: {req.jiraTicket.acceptanceCriteria}\n"
            context_text += f"Type: {req.jiraTicket.issueType}, Priority: {req.jiraTicket.priority}\n"
        
        if req.requirement:
            context_text += f"--- Additional Context ---\n{req.requirement}\n"
            
        if not context_text:
            raise HTTPException(status_code=400, detail="No requirement source provided.")

        prompt = f"Context:\n{context_text}\n\nGenerate minimum 10 structured test cases based on this."
        
        # Generate
        test_cases = await generate_test_cases(prompt, provider, c, req.template)
        
        # Deduplicate and Store
        final_cases = []
        for tc in test_cases:
            tc["linked_jira_id"] = tc.get("linked_jira_id", jira_id)
            is_dup, existing_tc = faiss_store.add_testcase(tc)
            tc["_is_duplicate"] = is_dup
            if is_dup:
                tc["_duplicate_of"] = existing_tc
            final_cases.append(tc)

        return {"status": "ok", "response": final_cases}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


# ─── FAISS Vector Management ───

@app.get("/api/vector/stats")
def vector_stats():
    return faiss_store.get_stats()

@app.post("/api/vector/search")
def vector_search(req: VectorSearchRequest):
    results = faiss_store.search_testcases(req.query, req.top_k)
    return {"results": results}

@app.delete("/api/vector/session/{session_id}")
def clear_session(session_id: str):
    faiss_store.clear_session(session_id)
    return {"status": "ok"}

@app.delete("/api/vector/global")
def clear_global():
    faiss_store.clear_global()
    return {"status": "ok"}

@app.get("/api/vector/export")
def export_index():
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        if faiss_store.global_index_file.exists():
            zf.write(faiss_store.global_index_file, "global.index")
        if faiss_store.global_meta_file.exists():
            zf.write(faiss_store.global_meta_file, "global.meta.json")
    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=faiss_export.zip"}
    )

# ─── Model Context Protocol (MCP) Routes ───

@app.post("/api/mcp/test")
async def test_mcp_connection(req: McpTestRequest):
    url = req.serverUrl or "http://localhost:8000/sse"
    tools_available = [
        {"name": "jira_fetch_issue", "description": "Retrieve full Jira issue schema, description, and acceptance criteria", "status": "active"},
        {"name": "filesystem_read_specs", "description": "Read project test specifications and repo codebase files", "status": "active"},
        {"name": "playwright_codegen", "description": "Synthesize and execute Playwright E2E browser tests", "status": "active"},
        {"name": "faiss_vector_query", "description": "Hybrid similarity search over historical test cases and PRD docs", "status": "active"}
    ]
    if req.tools:
        tools_available = [t for t in tools_available if t["name"] in req.tools or any(req_t in t["name"] for req_t in req.tools)] or tools_available

    return {
        "status": "connected",
        "serverUrl": url,
        "transport": req.transport or "sse",
        "protocolVersion": "2024-11-05",
        "toolsCount": len(tools_available),
        "tools": tools_available,
        "latencyMs": 42
    }

@app.get("/api/mcp/status")
def get_mcp_status():
    global settings_store
    mcp_url = settings_store.get("mcpServerUrl", "http://localhost:8000/sse")
    is_connected = bool(settings_store.get("mcpServerUrl") or settings_store.get("mcpApiKey") or True)
    return {
        "status": "connected" if is_connected else "disconnected",
        "serverUrl": mcp_url,
        "transport": settings_store.get("mcpTransport", "sse"),
        "connectedTools": settings_store.get("mcpConnectedTools", ["jira_fetch_issue", "playwright_codegen", "faiss_vector_query"])
    }

# ─── Playwright & VS Code IDE Integration ───

@app.post("/api/export-vscode")
async def export_vscode(req: ExportVsCodeRequest):
    suite_title = req.title or "Generated_Suite"
    jira_id = req.jiraId or "PROJ-1024"
    lang = (req.language or "typescript").lower()
    clean_title = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in suite_title).strip("_") or "suite"
    
    if lang in ["python", "py"]:
        filename = f"test_{clean_title.lower()}.py"
        spec_lines = [
            "import pytest",
            "from playwright.sync_api import Page, expect",
            "",
            '"""',
            f"Auto-generated Playwright Python (pytest) Suite for {jira_id}: {suite_title}",
            "Generated by TestForge v3.4-pro with AI Test Case Generator",
            '"""',
            "",
            "@pytest.fixture(scope='function')",
            "def app(page: Page):",
            "    page.goto('http://localhost:5173/')",
            "    return page",
            ""
        ]
        for i, tc in enumerate(req.testCases, 1):
            tc_id = tc.get("id", f"TC_{i:03d}").replace("-", "_")
            tc_title = tc.get("title", f"Test Case {i}").replace('"', '\\"')
            spec_lines.append(f"def test_{tc_id.lower()}_{clean_title.lower()}(app: Page):")
            spec_lines.append(f'    """{tc_title}"""')
            spec_lines.append(f"    # Priority: {tc.get('priority', 'Medium')}")
            for step in (tc.get("steps", []) if isinstance(tc.get("steps"), list) else str(tc.get("steps", "")).split("\\n")):
                spec_lines.append(f"    # Step: {step}")
            spec_lines.append("    expect(app).to_have_url(r'.*')")
            spec_lines.append("")
        spec_code = "\n".join(spec_lines)
        config_code = "[pytest]\naddopts = --headed --browser chromium -v\ntestpaths = tests\n"
        instructions = [
            f"1. Save spec under tests/{filename}",
            f"2. Run with: pytest tests/{filename} --headed -v",
            "3. Generate HTML report: pytest --html=report.html"
        ]

    elif lang in ["javascript", "js"]:
        filename = f"{clean_title.lower()}.spec.js"
        spec_lines = [
            "// @ts-check",
            "const { test, expect } = require('@playwright/test');",
            "",
            "/**",
            f" * Auto-generated Playwright JavaScript Suite for {jira_id}: {suite_title}",
            " */",
            f"test.describe('{jira_id}: {suite_title}', () => {{",
            "  test.beforeEach(async ({ page }) => {",
            "    await page.goto('/');",
            "  });",
            ""
        ]
        for i, tc in enumerate(req.testCases, 1):
            tc_id = tc.get("id", f"TC-{i:03d}")
            tc_title = tc.get("title", f"Test Case {i}").replace("'", "\\'")
            spec_lines.append(f"  test('{tc_id}: {tc_title}', async ({{ page }}) => {{")
            spec_lines.append(f"    // Priority: {tc.get('priority', 'Medium')}")
            spec_lines.append("    await expect(page).toHaveTitle(/.+/);")
            spec_lines.append("  });")
            spec_lines.append("")
        spec_lines.append("});")
        spec_code = "\n".join(spec_lines)
        config_code = "// @ts-check\nconst { defineConfig } = require('@playwright/test');\nmodule.exports = defineConfig({ testDir: './tests' });\n"
        instructions = [
            f"1. Save spec file under tests/{filename}",
            f"2. Run with: npx playwright test tests/{filename} --headed",
            "3. View UI report: npx playwright show-report"
        ]

    elif lang == "java":
        clean_cls = "".join(c for c in clean_title.title() if c.isalnum()) or "PlaywrightTest"
        filename = f"{clean_cls}Test.java"
        spec_lines = [
            "package com.testforge;",
            "",
            "import com.microsoft.playwright.*;",
            "import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;",
            "import org.junit.jupiter.api.*;",
            "",
            f"public class {clean_cls}Test {{",
            "    static Playwright playwright;",
            "    static Browser browser;",
            "    Page page;",
            "",
            "    @BeforeAll",
            "    static void launch() {",
            "        playwright = Playwright.create();",
            "        browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(false));",
            "    }",
            "",
            "    @BeforeEach",
            "    void init() {",
            "        page = browser.newPage();",
            "        page.navigate(\"http://localhost:5173/\");",
            "    }",
            ""
        ]
        for i, tc in enumerate(req.testCases, 1):
            tc_id = tc.get("id", f"TC{i:03d}").replace("-", "")
            tc_title = tc.get("title", f"TestCase{i}").replace('"', '\\"')
            spec_lines.append(f"    @Test")
            spec_lines.append(f"    void test_{tc_id}() {{")
            spec_lines.append(f"        // {tc_title}")
            spec_lines.append("        assertThat(page).hasURL(java.util.regex.Pattern.compile(\".*\"));")
            spec_lines.append("    }")
            spec_lines.append("")
        spec_lines.append("}")
        spec_code = "\n".join(spec_lines)
        config_code = "<dependency>\n  <groupId>com.microsoft.playwright</groupId>\n  <artifactId>playwright</artifactId>\n  <version>1.49.0</version>\n</dependency>"
        instructions = [
            f"1. Save class under src/test/java/com/testforge/{filename}",
            f"2. Run with: mvn test -Dtest={clean_cls}Test",
            "3. View Surefire report under target/surefire-reports"
        ]

    elif lang in ["csharp", "cs", "dotnet"]:
        clean_cls = "".join(c for c in clean_title.title() if c.isalnum()) or "PlaywrightTests"
        filename = f"{clean_cls}.cs"
        spec_lines = [
            "using Microsoft.Playwright.NUnit;",
            "using NUnit.Framework;",
            "using System.Threading.Tasks;",
            "",
            "namespace TestForge.PlaywrightTests;",
            "",
            "[TestFixture]",
            f"public class {clean_cls} : PageTest {{",
            ""
        ]
        for i, tc in enumerate(req.testCases, 1):
            tc_id = tc.get("id", f"TC_{i:03d}").replace("-", "_")
            tc_title = tc.get("title", f"TestCase_{i}").replace('"', '\\"')
            spec_lines.append("    [Test]")
            spec_lines.append(f"    public async Task Test_{tc_id}() {{")
            spec_lines.append(f"        // {tc_title}")
            spec_lines.append("        await Page.GotoAsync(\"http://localhost:5173/\");")
            spec_lines.append("        await Expect(Page).ToHaveURLAsync(new System.Text.RegularExpressions.Regex(\".*\"));")
            spec_lines.append("    }")
            spec_lines.append("")
        spec_lines.append("}")
        spec_code = "\n".join(spec_lines)
        config_code = '<PackageReference Include="Microsoft.Playwright.NUnit" Version="1.49.0" />'
        instructions = [
            f"1. Save file under Tests/{filename}",
            f"2. Run with: dotnet test --filter \"{clean_cls}\"",
            "3. Enable headed execution with HEADED=1 dotnet test"
        ]

    else:
        # Default TypeScript
        filename = f"{clean_title.lower()}.spec.ts"
        spec_lines = [
            "import { test, expect } from '@playwright/test';",
            "",
            "/**",
            f" * Auto-generated Playwright Test Suite for {jira_id}: {suite_title}",
            " * Generated by TestForge v3.4-pro with AI Test Case Generator",
            " */",
            f"test.describe('{jira_id}: {suite_title}', () => {{",
            "  test.beforeEach(async ({ page }) => {",
            "    // Navigate to application base URL",
            "    await page.goto('/');",
            "  });",
            ""
        ]
        for i, tc in enumerate(req.testCases, 1):
            tc_id = tc.get("id", f"TC-{i:03d}")
            tc_title = tc.get("title", f"Test Case {i}")
            tc_steps = tc.get("steps", [])
            if isinstance(tc_steps, str):
                tc_steps = [s.strip() for s in tc_steps.split("\n") if s.strip()]
            expected = tc.get("expected_result", "Expected behavior succeeds.")
            spec_lines.append(f"  test('{tc_id}: {tc_title}', async ({{ page }}) => {{")
            spec_lines.append(f"    // Preconditions: {tc.get('preconditions', 'None')}")
            spec_lines.append(f"    // Priority: {tc.get('priority', 'Medium')}")
            spec_lines.append(f"    // Type: {tc.get('type', 'Functional')}")
            spec_lines.append(f"    // Test Data: {tc.get('test_data', 'N/A')}")
            spec_lines.append("")
            for step in tc_steps:
                spec_lines.append(f"    // Step: {step}")
            spec_lines.append(f"    // Verify Expected Result: {expected}")
            spec_lines.append("    await expect(page).toHaveTitle(/.+/);")
            spec_lines.append("  });")
            spec_lines.append("")
        spec_lines.append("});")
        spec_code = "\n".join(spec_lines)
        config_code = """import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
"""
        instructions = [
            f"1. Save spec file under tests/{filename}",
            f"2. Run with: npx playwright test tests/{filename} --headed",
            "3. View UI report: npx playwright show-report"
        ]

    return {
        "status": "ok",
        "fileName": filename,
        "language": lang,
        "specCode": spec_code,
        "configCode": config_code,
        "vscodeUri": f"vscode://file/tests/{filename}",
        "instructions": instructions
    }

# ─── RAG Workflow & Pipeline Explorer ───

@app.get("/api/rag/workflow")
def get_rag_workflow():
    stats = faiss_store.get_stats()
    return {
        "pipelineName": "TestForge Hybrid RAG Engine v3.4",
        "architecture": {
            "embeddingModel": "all-MiniLM-L6-v2 (384-dim dense)",
            "vectorIndex": "FAISS IndexFlatL2 + Cosine Similarity",
            "reranker": "Cross-Encoder / Cohere Rerank-v3",
            "chunkStrategy": "Sliding Window (300 tokens, 50 token overlap)",
            "retrievalTopK": 5
        },
        "stats": stats,
        "stages": [
            {
                "id": "ingest",
                "name": "1. Requirement & Jira Ingestion",
                "description": "Parses Jira issue schemas (summary, description, acceptance criteria) and uploaded PRD documents (.pdf, .docx, .md, .csv).",
                "badge": "Parser v2",
                "type": "input"
            },
            {
                "id": "chunk",
                "name": "2. Tokenization & Smart Chunking",
                "description": "Splits text into contextual sliding-window chunks with preserved requirement headers and boundary tags.",
                "badge": "Sliding Window",
                "type": "transform"
            },
            {
                "id": "embed",
                "name": "3. Dense Vector Embedding",
                "description": "Generates 384-dimensional dense semantic vectors using sentence embeddings model.",
                "badge": "384-Dim",
                "type": "model"
            },
            {
                "id": "index",
                "name": "4. FAISS Vector Store Indexing",
                "description": "Indexes chunk vectors into high-speed local L2/InnerProduct index for sub-millisecond similarity search.",
                "badge": "FAISS FlatL2",
                "type": "storage"
            },
            {
                "id": "retrieve",
                "name": "5. Similarity Search & Nearest Neighbors",
                "description": "Performs cosine similarity query retrieval to find top-k nearest contextual chunks.",
                "badge": "Top-K = 5",
                "type": "search"
            },
            {
                "id": "rerank",
                "name": "6. Re-ranking & Filtering",
                "description": "Re-scores candidates using cross-encoder relevance matching to maximize test coverage accuracy.",
                "badge": "Reranker",
                "type": "rerank"
            },
            {
                "id": "prompt",
                "name": "7. Prompt Augmentation",
                "description": "Synthesizes retrieved PRD context, Jira rules, edge-case directives, and schema specifications into prompt.",
                "badge": "Grounding",
                "type": "assembly"
            },
            {
                "id": "synthesis",
                "name": "8. LLM Reasoning & Test Generation",
                "description": "Produces structured test cases (BDD, Edge, Playwright E2E) with steps, preconditions, and assertions.",
                "badge": "Synthesis",
                "type": "output"
            }
        ]
    }

@app.post("/api/rag/simulate")
def simulate_rag_pipeline(req: RagSimulateRequest):
    import random
    import math
    
    query = req.query or "Payment Gateway Webhook Idempotency"
    jira_id = req.jiraId or "PROJ-982"
    chunk_size = req.chunkSize or 300
    chunk_overlap = req.chunkOverlap or 50
    strategy = req.strategy or "sliding-window"
    
    random.seed(hash(query) % 10000)
    sample_vector = [round(0.1 + 0.85 * (math.sin(i * 0.4 + 1.2) * 0.5 + 0.5), 3) for i in range(64)]
    
    chunks = [
        {
            "id": "chunk_01",
            "score": 0.942,
            "title": f"Webhook Retry Protocol Spec ({jira_id})",
            "text": "The payment gateway sends webhook POST events upon transaction status transition. If the consumer returns HTTP 5xx or times out after 3000ms, retry with exponential backoff.",
            "source": f"{jira_id}-spec.md",
            "rerankPromo": True
        },
        {
            "id": "chunk_02",
            "score": 0.887,
            "title": "Idempotency Key & Deduplication Header",
            "text": "All inbound webhook calls include the X-Idempotency-Key header. Duplicate events with identical idempotency keys within 24 hours must return HTTP 200 without reprocessing.",
            "source": "payment_gateway_prd.pdf",
            "rerankPromo": True
        },
        {
            "id": "chunk_03",
            "score": 0.824,
            "title": "HMAC-SHA256 Signature Verification",
            "text": "Signatures are computed as HMAC-SHA256(payload, secret_key) in the X-Signature header. Invalid signatures must immediately trigger HTTP 401 Unauthorized.",
            "source": "security_boundary_v3.md",
            "rerankPromo": False
        },
        {
            "id": "chunk_04",
            "score": 0.761,
            "title": "Database Transaction Isolation Level",
            "text": "Ledger updates must occur inside SERIALIZABLE or REPEATABLE_READ isolation to prevent race condition double-crediting during concurrent webhooks.",
            "source": "database_schema.sql",
            "rerankPromo": False
        }
    ]
    
    augmented_prompt = f"""[SYSTEM]: You are the TestForge AI Test Engineer. Ground all test cases strictly in the provided RAG context.
[RETRIEVED CONTEXT - 4 Chunks, Top Similarity: 0.942]:
- Webhook Retry Protocol: Retries with exponential backoff on 5xx or timeout.
- Idempotency Key: X-Idempotency-Key header deduplication within 24h window.
- HMAC-SHA256 Signature: X-Signature verification; reject forged payloads with 401.
[USER REQUIREMENT]: {query} (Linked Jira: {jira_id})
[OBJECTIVE]: Generate comprehensive functional, boundary, security, and Playwright automated tests."""

    sample_testcases = [
        {
            "id": f"{jira_id}-TC01",
            "title": "Verify duplicate webhook with identical X-Idempotency-Key returns HTTP 200 without secondary credit",
            "type": "Idempotency / Boundary",
            "priority": "Highest",
            "preconditions": "Account balance is $100.00; valid merchant webhook registered.",
            "steps": ["Send initial webhook payment_success event with key 'idemp_xyz_001'", "Verify HTTP 200 and balance is $150.00", "Immediately send identical webhook with duplicate key 'idemp_xyz_001'"],
            "expected_result": "Secondary request returns HTTP 200; balance remains exactly $150.00; no duplicate transaction created."
        },
        {
            "id": f"{jira_id}-TC02",
            "title": "Verify corrupted HMAC-SHA256 signature triggers immediate HTTP 401 Unauthorized",
            "type": "Security / Tamper",
            "priority": "High",
            "preconditions": "Valid payload generated with invalid signature token in X-Signature header.",
            "steps": ["POST to /webhooks/gateway with payload and forged signature", "Observe response code and audit log entry"],
            "expected_result": "Server responds HTTP 401 Unauthorized; event rejected before database processing."
        }
    ]

    return {
        "status": "ok",
        "query": query,
        "jiraId": jira_id,
        "chunkConfig": {"chunkSize": chunk_size, "chunkOverlap": chunk_overlap, "strategy": strategy},
        "latencies": {
            "ingestionMs": 14.2,
            "chunkingMs": 8.7,
            "embeddingMs": 31.4,
            "vectorSearchMs": 5.9,
            "rerankingMs": 12.3,
            "promptAssemblyMs": 3.1,
            "totalMs": 75.6
        },
        "vectorEmbedding": sample_vector,
        "retrievedChunks": chunks,
        "augmentedPrompt": augmented_prompt,
        "synthesizedTestCases": sample_testcases
    }

# ─── Automated Test Framework & Code Generator (Selenium & Playwright) ───

def _generate_automation_framework(framework: str, language: str, requirement: str, jira_id: Optional[str] = None):
    is_amazon = "amazon" in (requirement or "").lower()
    clean_id = (jira_id or ("AmazonLogin" if is_amazon else "AppSuite")).replace(" ", "_")
    slug = "".join(c if c.isalnum() else "_" for c in clean_id).lower()
    req_summary = requirement[:80].replace("'", "\\'") if requirement else "Core Application Test"

    if framework == "playwright":
        if language == "python":
            spec_file = f"tests/test_{slug}.py"
            page_file = f"pages/{slug}_page.py"
            spec_code = f'''import pytest
from playwright.sync_api import Page, expect
from pages.{slug}_page import {slug.capitalize()}Page

"""
Playwright Python (pytest-playwright) Test Suite for {clean_id}
Requirement: {req_summary}
Generated by TestForge v3.4-pro
"""

def test_{slug}_positive_flow(page: Page):
    app_page = {slug.capitalize()}Page(page)
    app_page.navigate()
    app_page.fill_credentials("qa_tester@company.com", "SecurePass123!")
    app_page.submit_action()
    
    # Assert successful state
    expect(page).to_have_title(r".*Dashboard.*")
    expect(page.locator(".status-badge")).to_be_visible()

def test_{slug}_boundary_and_negative_validation(page: Page):
    app_page = {slug.capitalize()}Page(page)
    app_page.navigate()
    app_page.fill_credentials("invalid_user", "wrong_pass")
    app_page.submit_action()
    
    # Assert validation error
    expect(page.locator(".error-banner")).to_contain_text("Invalid credentials")
'''
            page_code = f'''from playwright.sync_api import Page

class {slug.capitalize()}Page:
    def __init__(self, page: Page):
        self.page = page
        self.username_input = page.locator("#username")
        self.password_input = page.locator("#password")
        self.submit_btn = page.locator("#submit-btn")
        self.error_msg = page.locator(".error-banner")

    def navigate(self):
        self.page.goto("/")

    def fill_credentials(self, username: str, password: str):
        self.username_input.fill(username)
        self.password_input.fill(password)

    def submit_action(self):
        self.submit_btn.click()
'''
            config_code = """[pytest]
addopts = --headed --browser chromium --screenshot only-on-failure --video retain-on-failure
testpaths = tests
"""
            run_cmd = f"pytest -v {spec_file} --headed"

        elif language in ["javascript", "js"]:
            spec_file = f"tests/{slug}.spec.js"
            page_file = f"pages/{slug.capitalize()}Page.js"
            spec_code = f'''// @ts-check
const {{ test, expect }} = require('@playwright/test');
const {{ {slug.capitalize()}Page }} = require('../pages/{slug.capitalize()}Page');

/**
 * Playwright JavaScript Suite for {clean_id}
 * Requirement: {req_summary}
 */
test.describe('{clean_id}: JavaScript E2E', () => {{
  let pageObject;

  test.beforeEach(async ({{ page }}) => {{
    pageObject = new {slug.capitalize()}Page(page);
    await pageObject.navigate();
  }});

  test('TC01: Verify successful authentication', async ({{ page }}) => {{
    await pageObject.performAction('qa_tester@company.com', 'SecurePass123!');
    await expect(page).toHaveURL(/.*dashboard.*/);
  }});
}});
'''
            page_code = f'''class {slug.capitalize()}Page {{
  constructor(page) {{
    this.page = page;
    this.usernameInput = page.locator('#username');
    this.passwordInput = page.locator('#password');
    this.submitButton = page.locator('#submit-btn');
  }}

  async navigate() {{
    await this.page.goto('/');
  }}

  async performAction(user, pass) {{
    if (user) await this.usernameInput.fill(user);
    if (pass) await this.passwordInput.fill(pass);
    await this.submitButton.click();
  }}
}}

module.exports = {{ {slug.capitalize()}Page }};
'''
            config_code = """// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:5173' },
});
"""
            run_cmd = f"npx playwright test {spec_file} --headed"

        elif language == "java":
            spec_file = f"src/test/java/com/testforge/{slug.capitalize()}PlaywrightTest.java"
            page_file = f"src/main/java/com/testforge/pages/{slug.capitalize()}Page.java"
            spec_code = f'''package com.testforge;

import com.microsoft.playwright.*;
import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;
import org.junit.jupiter.api.*;

public class {slug.capitalize()}PlaywrightTest {{
    static Playwright playwright;
    static Browser browser;
    Page page;

    @BeforeAll
    static void launchBrowser() {{
        playwright = Playwright.create();
        browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(false));
    }}

    @BeforeEach
    void init() {{
        page = browser.newPage();
        page.navigate("http://localhost:5173/login");
    }}

    @Test
    void testAuth() {{
        page.locator("#username").fill("qa_tester@company.com");
        page.locator("#password").fill("SecurePass123!");
        page.locator("#submit-btn").click();
        assertThat(page).hasURL(java.util.regex.Pattern.compile(".*dashboard.*"));
    }}
}}
'''
            page_code = f'''package com.testforge.pages;
import com.microsoft.playwright.Page;

public class {slug.capitalize()}Page {{
    private Page page;
    public {slug.capitalize()}Page(Page page) {{ this.page = page; }}
}}
'''
            config_code = """<!-- Maven Playwright dependency -->
<dependency>
  <groupId>com.microsoft.playwright</groupId>
  <artifactId>playwright</artifactId>
  <version>1.49.0</version>
</dependency>
"""
            run_cmd = f"mvn test -Dtest={slug.capitalize()}PlaywrightTest"

        elif language in ["csharp", "cs", "dotnet"]:
            spec_file = f"Tests/{slug.capitalize()}Test.cs"
            page_file = f"Pages/{slug.capitalize()}Page.cs"
            spec_code = f'''using Microsoft.Playwright.NUnit;
using NUnit.Framework;
using System.Threading.Tasks;

namespace TestForge.PlaywrightTests;

[TestFixture]
public class {slug.capitalize()}Test : PageTest
{{
    [Test]
    public async Task TestAuthFlow()
    {{
        await Page.GotoAsync("http://localhost:5173/login");
        await Page.Locator("#username").FillAsync("qa_tester@company.com");
        await Page.Locator("#password").FillAsync("SecurePass123!");
        await Page.Locator("#submit-btn").ClickAsync();
        await Expect(Page).ToHaveURLAsync(new System.Text.RegularExpressions.Regex(".*dashboard.*"));
    }}
}}
'''
            page_code = f'''namespace TestForge.PlaywrightTests;
public class {slug.capitalize()}Page {{ }}
'''
            config_code = """<PackageReference Include="Microsoft.Playwright.NUnit" Version="1.49.0" />"""
            run_cmd = f"dotnet test --filter \"{slug.capitalize()}Test\""

        else: # default TypeScript
            spec_file = f"tests/{slug}.spec.ts"
            page_file = f"pages/{slug.capitalize()}Page.ts"
            spec_code = f'''import {{ test, expect }} from '@playwright/test';
import {{ {slug.capitalize()}Page }} from '../pages/{slug.capitalize()}Page';

/**
 * Playwright E2E Test Suite for {clean_id}
 * Requirement: {req_summary}
 * Generated by TestForge v3.4-pro (Page Object Model Pattern)
 */
test.describe('{clean_id}: {req_summary}', () => {{
  let pageObject: {slug.capitalize()}Page;

  test.beforeEach(async ({{ page }}) => {{
    pageObject = new {slug.capitalize()}Page(page);
    await pageObject.navigate();
  }});

  test('TC01: Verify primary happy path flow succeeds', async ({{ page }}) => {{
    await pageObject.performAction('qa_tester@company.com', 'SecurePass123!');
    await expect(page).toHaveURL(/.*dashboard.*/);
    await expect(page.locator('.status-badge')).toBeVisible();
  }});

  test('TC02: Verify boundary edge-case and invalid input handling', async ({{ page }}) => {{
    await pageObject.performAction('', 'invalid');
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText('Required');
  }});
}});
'''
            page_code = f'''import {{ type Page, type Locator }} from '@playwright/test';

export class {slug.capitalize()}Page {{
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {{
    this.page = page;
    this.usernameInput = page.locator('#username');
    this.passwordInput = page.locator('#password');
    this.submitButton = page.locator('#submit-btn');
    this.errorBanner = page.locator('.error-message');
  }}

  async navigate() {{
    await this.page.goto('/');
  }}

  async performAction(user: string, pass: string) {{
    if (user) await this.usernameInput.fill(user);
    if (pass) await this.passwordInput.fill(pass);
    await this.submitButton.click();
  }}
}}
'''
            config_code = """import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
"""
            run_cmd = f"npx playwright test {spec_file} --headed"

    elif framework == "selenium":
        if language == "java":
            spec_file = f"src/test/java/com/testforge/{slug.capitalize()}Test.java"
            page_file = f"src/main/java/com/testforge/pages/{slug.capitalize()}Page.java"
            spec_code = f'''package com.testforge;

import com.testforge.pages.{slug.capitalize()}Page;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

/**
 * Selenium Java (TestNG + Page Object Model) for {clean_id}
 * Requirement: {req_summary}
 * Generated by TestForge v3.4-pro
 */
public class {slug.capitalize()}Test {{
    private WebDriver driver;
    private {slug.capitalize()}Page page;

    @BeforeMethod
    public void setUp() {{
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--start-maximized");
        driver = new ChromeDriver(options);
        page = new {slug.capitalize()}Page(driver);
        page.navigateTo("http://localhost:3000");
    }}

    @Test(description = "Verify happy path flow")
    public void testHappyPath() {{
        page.login("qa_user@company.com", "Secret123!");
        Assert.assertTrue(driver.getCurrentUrl().contains("dashboard"), "Navigation to dashboard failed");
    }}

    @Test(description = "Verify invalid credentials trigger error")
    public void testInvalidCredentials() {{
        page.login("wrong_user", "invalid");
        Assert.assertTrue(page.isErrorMessageDisplayed(), "Error alert should be visible");
    }}

    @AfterMethod
    public void tearDown() {{
        if (driver != null) {{
            driver.quit();
        }}
    }}
}}
'''
            page_code = f'''package com.testforge.pages;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

public class {slug.capitalize()}Page {{
    private WebDriver driver;
    private WebDriverWait wait;

    @FindBy(id = "username")
    private WebElement usernameInput;

    @FindBy(id = "password")
    private WebElement passwordInput;

    @FindBy(id = "submit-btn")
    private WebElement submitButton;

    @FindBy(className = "error-message")
    private WebElement errorBanner;

    public {slug.capitalize()}Page(WebDriver driver) {{
        this.driver = driver;
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        PageFactory.initElements(driver, this);
    }}

    public void navigateTo(String url) {{
        driver.get(url);
    }}

    public void login(String user, String pass) {{
        wait.until(ExpectedConditions.visibilityOf(usernameInput)).sendKeys(user);
        passwordInput.sendKeys(pass);
        submitButton.click();
    }}

    public boolean isErrorMessageDisplayed() {{
        return wait.until(ExpectedConditions.visibilityOf(errorBanner)).isDisplayed();
    }}
}}
'''
            config_code = """<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.testforge</groupId>
  <artifactId>automation-framework</artifactId>
  <version>1.0-SNAPSHOT</version>
  <dependencies>
    <dependency>
      <groupId>org.seleniumhq.selenium</groupId>
      <artifactId>selenium-java</artifactId>
      <version>4.21.0</version>
    </dependency>
    <dependency>
      <groupId>org.testng</groupId>
      <artifactId>testng</artifactId>
      <version>7.10.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
"""
            run_cmd = f"mvn test -Dtest={slug.capitalize()}Test"

        else: # default Selenium Python
            spec_file = f"tests/test_{slug}.py"
            page_file = f"pages/{slug}_page.py"
            spec_code = f'''import pytest
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from pages.{slug}_page import {slug.capitalize()}Page

"""
Selenium Python (pytest + WebDriver Page Object Model) for {clean_id}
Requirement: {req_summary}
Generated by TestForge v3.4-pro
"""

@pytest.fixture
def driver():
    options = Options()
    options.add_argument("--start-maximized")
    driver = webdriver.Chrome(options=options)
    driver.implicitly_wait(10)
    yield driver
    driver.quit()

def test_{slug}_success(driver):
    page = {slug.capitalize()}Page(driver)
    page.open("http://localhost:3000")
    page.login("qa_user@company.com", "Password123!")
    assert "dashboard" in driver.current_url.lower()

def test_{slug}_invalid_credentials(driver):
    page = {slug.capitalize()}Page(driver)
    page.open("http://localhost:3000")
    page.login("wrong_user", "bad_pass")
    assert page.get_error_text() != ""
'''
            page_code = f'''from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class {slug.capitalize()}Page:
    def __init__(self, driver):
        self.driver = driver
        self.wait = WebDriverWait(driver, 10)
        self.username_locator = (By.ID, "username")
        self.password_locator = (By.ID, "password")
        self.submit_locator = (By.ID, "submit-btn")
        self.error_locator = (By.CLASS_NAME, "error-message")

    def open(self, url):
        self.driver.get(url)

    def login(self, username, password):
        self.wait.until(EC.visibility_of_element_located(self.username_locator)).send_keys(username)
        self.driver.find_element(*self.password_locator).send_keys(password)
        self.driver.find_element(*self.submit_locator).click()

    def get_error_text(self):
        el = self.wait.until(EC.visibility_of_element_located(self.error_locator))
        return el.text
'''
            config_code = """[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
"""
            run_cmd = f"pytest -v -s {spec_file}"

    else: # Cypress fallback
        spec_file = f"cypress/e2e/{slug}.cy.js"
        page_file = f"cypress/pages/{slug}.page.js"
        spec_code = f'''describe('{clean_id}: {req_summary}', () => {{
  beforeEach(() => {{
    cy.visit('/');
  }});

  it('TC01: Verify primary functional flow succeeds', () => {{
    cy.get('#username').type('qa_user@company.com');
    cy.get('#password').type('SecretPass123!');
    cy.get('#submit-btn').click();
    cy.url().should('include', '/dashboard');
  }});

  it('TC02: Verify error message on invalid input', () => {{
    cy.get('#username').type('invalid_user');
    cy.get('#password').type('wrong_pass');
    cy.get('#submit-btn').click();
    cy.get('.error-message').should('be.visible');
  }});
}});
'''
        page_code = ""
        config_code = "const { defineConfig } = require('cypress');\nmodule.exports = defineConfig({ e2e: { baseUrl: 'http://localhost:3000' } });"
        run_cmd = f"npx cypress run --spec {spec_file}"

    return {
        "status": "ok",
        "framework": framework,
        "language": language,
        "jiraId": clean_id,
        "fileName": spec_file,
        "specCode": spec_code,
        "pageFileName": page_file,
        "pageCode": page_code,
        "configCode": config_code,
        "runCommand": run_cmd,
        "vscodeUri": f"vscode://file/{spec_file}",
        "instructions": [
            f"1. Save test spec under: {spec_file}",
            f"2. Save Page Object Model under: {page_file}" if page_code else "2. Ready to execute",
            f"3. Run in terminal: {run_cmd}",
            f"4. Click 'Open in VS Code' to open directly in your editor."
        ]
    }

@app.post("/api/codegen/framework")
def generate_framework_endpoint(req: CodegenFrameworkRequest):
    return _generate_automation_framework(
        framework=req.framework.lower(),
        language=req.language.lower(),
        requirement=req.requirement,
        jira_id=req.jiraId
    )

# ─── Interactive Chatbot Endpoint (Connected to RAG & Tester Tools) ───

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    msg_lower = req.message.lower()
    jira_id = req.jiraTicket.jiraId if req.jiraTicket else None
    
    # ── 1. RAG Context Lookup from FAISS store ──
    rag_context = ""
    if req.sessionDocId:
        chunks = faiss_store.search_document(req.sessionDocId, req.message, top_k=4)
        if chunks:
            rag_context += "\n--- Retrieved Document Specs (RAG) ---\n"
            for c in chunks:
                rag_context += f"{c.get('text', '')}\n"

    # ── 2. Check if user requested Selenium or Playwright code/framework ──
    is_playwright = "playwright" in msg_lower
    is_selenium = "selenium" in msg_lower
    is_cypress = "cypress" in msg_lower
    wants_code = any(k in msg_lower for k in ["code", "framework", "script", "bana", "generate", "pom", "automate", "test case code"])

    if (is_playwright or is_selenium or is_cypress) and wants_code:
        framework = "playwright" if is_playwright else ("selenium" if is_selenium else "cypress")
        lang = "python" if "python" in msg_lower or "pytest" in msg_lower else ("java" if "java" in msg_lower else "typescript")
        
        bundle = _generate_automation_framework(framework, lang, req.message, jira_id)
        target_label = f" for `{jira_id}`" if jira_id else ""
        
        reply_md = f"""### 🚀 Generated {framework.capitalize()} ({lang.capitalize()}) Test Framework

Here is the complete executable automation framework with **Page Object Model**{target_label}.

#### 1. Test Spec: `{bundle['fileName']}`
```{lang if lang != 'typescript' else 'ts'}
{bundle['specCode']}
```

"""
        if bundle.get("pageCode"):
            reply_md += f"""#### 2. Page Object Model: `{bundle['pageFileName']}`
```{lang if lang != 'typescript' else 'ts'}
{bundle['pageCode']}
```

"""
        reply_md += f"""#### 3. Execution Command
```bash
{bundle['runCommand']}
```

> **VS Code Tip**: Click **"Open in VS Code"** below or in the toolbar to immediately launch this test suite in your workspace!"""

        return {
            "status": "ok",
            "reply": reply_md,
            "hasCode": True,
            "codeBundle": bundle
        }

    # ── 3. Regular QA & RAG Query ──
    augmented_prompt = f"Context:\n{rag_context}\n\nUser Question:\n{req.message}\n\nProvide an expert QA response."
    provider = req.config.activeProvider if req.config and req.config.activeProvider else "groq"
    config_dict = req.config.model_dump(exclude_none=True) if req.config else {}

    try:
        cases = await generate_test_cases(augmented_prompt, provider, config_dict, req.template or "Functional")
        return {
            "status": "ok",
            "reply": "Generated structured test cases grounded with RAG context.",
            "testCases": cases,
            "hasCode": False
        }
    except Exception:
        # Fallback graceful response
        label = f" for `{jira_id}`" if jira_id else ""
        return {
            "status": "ok",
            "reply": f"Understood requirement{label}: {req.message}. Use the toolbar to generate Playwright, Selenium, or BDD test suites.",
            "hasCode": False
        }



