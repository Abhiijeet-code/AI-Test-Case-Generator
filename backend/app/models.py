from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Dict, Any

class ConfigPayload(BaseModel):
    model_config = ConfigDict(extra="allow")  # accept flat keys: groqApiKey, groqModel, etc.

    jiraBaseUrl: Optional[str] = None
    jiraEmail: Optional[str] = None
    jiraApiToken: Optional[str] = None
    activeProvider: Optional[str] = None
    providers: Optional[Dict[str, Any]] = None
    maxDocTokens: Optional[int] = 8000
    faissMaxResults: Optional[int] = 5
    # MCP settings
    mcpServerUrl: Optional[str] = None
    mcpTransport: Optional[str] = "sse"
    mcpApiKey: Optional[str] = None
    mcpEnvironment: Optional[str] = "local"
    mcpConnectedTools: Optional[List[str]] = None

class JiraTicketContext(BaseModel):
    model_config = ConfigDict(extra="allow")

    jiraId: Optional[str] = None
    key: Optional[str] = None
    summary: Optional[str] = ""
    description: Optional[str] = ""
    priority: Optional[str] = "Medium"
    status: Optional[str] = "To Do"
    issueType: Optional[str] = "Story"
    components: Optional[List[str]] = None
    acceptanceCriteria: Optional[str] = ""

class GenerateRequest(BaseModel):
    requirement: Optional[str] = None
    jiraTicket: Optional[JiraTicketContext] = None
    config: Optional[ConfigPayload] = None
    template: str = "Functional"
    sessionDocId: Optional[str] = None

class TestConnectionRequest(BaseModel):
    provider: str
    config: ConfigPayload

class JiraTestConnectionRequest(BaseModel):
    config: ConfigPayload

class FetchIssueRequest(BaseModel):
    jiraId: str
    config: ConfigPayload

class VectorSearchRequest(BaseModel):
    query: str
    top_k: int = 5

class McpTestRequest(BaseModel):
    serverUrl: Optional[str] = "http://localhost:8000/sse"
    transport: Optional[str] = "sse"
    apiKey: Optional[str] = None
    tools: Optional[List[str]] = None

class ExportVsCodeRequest(BaseModel):
    testCases: List[Dict[str, Any]]
    title: Optional[str] = "GeneratedTestSuite"
    jiraId: Optional[str] = "PROJ-1024"
    language: Optional[str] = "typescript"
    framework: Optional[str] = "playwright"

class RagSimulateRequest(BaseModel):
    query: Optional[str] = "Payment Gateway Webhook Idempotency"
    jiraId: Optional[str] = "PROJ-982"
    chunkSize: Optional[int] = 300
    chunkOverlap: Optional[int] = 50
    strategy: Optional[str] = "sliding-window"

class ChatRequest(BaseModel):
    message: str
    sessionId: Optional[str] = None
    jiraTicket: Optional[JiraTicketContext] = None
    config: Optional[ConfigPayload] = None
    template: Optional[str] = "Functional"
    sessionDocId: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None

class CodegenFrameworkRequest(BaseModel):
    framework: str = "playwright"
    language: str = "typescript"
    pattern: str = "page-object-model"
    requirement: str
    jiraId: Optional[str] = "PROJ-1024"
    config: Optional[ConfigPayload] = None
