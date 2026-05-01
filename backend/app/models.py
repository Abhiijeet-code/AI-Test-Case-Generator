from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class ConfigPayload(BaseModel):
    jiraBaseUrl: Optional[str] = None
    jiraEmail: Optional[str] = None
    jiraApiToken: Optional[str] = None
    activeProvider: Optional[str] = None
    providers: Optional[Dict[str, Any]] = None
    maxDocTokens: Optional[int] = 8000
    faissMaxResults: Optional[int] = 5

class JiraTicketContext(BaseModel):
    jiraId: str
    summary: str
    description: str
    priority: str
    status: str
    issueType: str
    components: List[str]
    acceptanceCriteria: str

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
