// Handles the creation of the system prompt to enforce Jira Test Case format

export interface JiraTicketContext {
  jiraId: string;
  summary: string;
  description: string;
  priority?: string;
  status?: string;
  acceptanceCriteria?: string;
}

export function buildJiraTestCasePrompt(context: JiraTicketContext | string): string {
  let contextStr = '';
  if (typeof context === 'string') {
    contextStr = `## Requirement\n${context}`;
  } else {
    contextStr = `## Jira Ticket Details
- **Jira ID**: ${context.jiraId}
- **Summary**: ${context.summary}
- **Priority**: ${context.priority || 'Not specified'}
- **Status**: ${context.status || 'Not specified'}

## Description
${context.description || 'No description provided.'}

${context.acceptanceCriteria ? `## Acceptance Criteria\n${context.acceptanceCriteria}` : ''}`;
  }
  
  return `
You are a Staff-Level Quality Assurance Engineer. Your task is to generate comprehensive, highly detailed Functional and Non-Functional Test Cases based on the following context. 
Your output MUST read exactly like a meticulous human QA professional wrote it. Provide rich contextual preconditions, practical and expansive test data, and highly granular step-by-step instructions.

${contextStr}

---

You MUST output exactly a JSON array containing a minimum of 5 test cases. Generate enough test cases to FULLY cover functional AND non-functional aspects. Do NOT output any markdown, only valid JSON. 
Output format MUST be a direct JSON array of objects conforming to this strict schema:

[
  {
    "id": "TC_001",
    "title": "A highly descriptive, human-readable title",
    "type": "Positive | Negative | Edge | Boundary | Security",
    "priority": "P0 | P1 | P2",
    "preconditions": "String of very detailed preconditions required before testing",
    "steps": ["Step 1: very detailed action", "Step 2: very detailed action", "Step 3: ..."],
    "test_data": "String of realistic, specific test data (e.g. email='test@example.com')",
    "expected_result": "String of the precise expected outcome",
    "linked_jira_id": "${typeof context === 'string' ? '' : context.jiraId}"
  }
]
`.trim();
}
