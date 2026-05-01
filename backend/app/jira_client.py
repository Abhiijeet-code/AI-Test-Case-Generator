import httpx
from typing import Dict, Any

async def fetch_jira_issue(jira_id: str, base_url: str, email: str, token: str) -> Dict[str, Any]:
    clean_base = base_url.rstrip('/')
    url = f"{clean_base}/rest/api/3/issue/{jira_id}"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            auth=(email, token),
            headers={"Accept": "application/json"},
            timeout=15.0
        )
        if response.status_code == 401:
            raise Exception("Jira authentication failed. Check your email and API token.")
        elif response.status_code == 404:
            raise Exception(f"Jira issue '{jira_id}' not found.")
        response.raise_for_status()
        data = response.json()
        
        fields = data.get("fields", {})
        
        def extract_text(adf_or_string: Any) -> str:
            if not adf_or_string: return ""
            if isinstance(adf_or_string, str): return adf_or_string
            if "content" in adf_or_string:
                return "\n".join(extract_text(node) for node in adf_or_string["content"]).strip()
            if "text" in adf_or_string:
                return adf_or_string["text"]
            return ""
            
        description = extract_text(fields.get("description"))
        
        ac_field = fields.get("customfield_10016") or fields.get("customfield_10017") or fields.get("customfield_10056")
        acceptance_criteria = extract_text(ac_field)
        
        components = [c.get("name") for c in fields.get("components", []) if c.get("name")]
        
        return {
            "jiraId": jira_id,
            "summary": fields.get("summary", ""),
            "description": description,
            "priority": fields.get("priority", {}).get("name", ""),
            "status": fields.get("status", {}).get("name", ""),
            "issueType": fields.get("issuetype", {}).get("name", ""),
            "components": components,
            "acceptanceCriteria": acceptance_criteria
        }

async def test_jira_connection(base_url: str, email: str, token: str) -> bool:
    clean_base = base_url.rstrip('/')
    url = f"{clean_base}/rest/api/3/myself"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            auth=(email, token),
            headers={"Accept": "application/json"},
            timeout=10.0
        )
        if response.status_code == 401:
            raise Exception("Authentication failed. Check your email and API token.")
        elif response.status_code == 403:
            raise Exception("Forbidden. Your account may lack API access.")
        response.raise_for_status()
        return True
