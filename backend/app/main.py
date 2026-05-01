import os
import io
import json
import uuid
import zipfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from typing import Dict, Any, List

from app.models import (
    GenerateRequest, 
    TestConnectionRequest, 
    JiraTestConnectionRequest, 
    FetchIssueRequest,
    VectorSearchRequest,
    ConfigPayload
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
    await test_llm_connection(req.provider, req.config.model_dump())
    return {"status": "ok", "message": "Connection successful"}

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
    c = req.config.model_dump() if req.config else {}
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
