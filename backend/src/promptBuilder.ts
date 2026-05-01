// Handles the creation of the system prompt to enforce Jira Test Case format

export interface JiraTicketContext {
  jiraId: string;
  summary: string;
  description: string;
  priority?: string;
  status?: string;
  acceptanceCriteria?: string;
  issueType?: string;
  components?: string[];
}

export type TestTemplate = 'Functional' | 'Regression' | 'Smoke' | 'Edge' | 'Security' | 'Custom';

const TEMPLATE_INSTRUCTIONS: Record<TestTemplate, string> = {
  Functional: `Focus on FUNCTIONAL test cases: verify each feature works correctly end-to-end per the acceptance criteria. Cover happy paths, input validation, UI behavior, and data integrity. Include both positive and negative test cases.`,
  Regression: `Focus on REGRESSION test cases: ensure existing functionality is not broken by recent changes. Cover all previously passing flows, boundary conditions, and integration points. Include smoke-level sanity checks plus deeper regression scenarios.`,
  Smoke: `Focus on SMOKE test cases: a minimal set of critical path tests to verify the build is stable. Cover the most important user-facing flows only — aim for maximum coverage with minimum test count (5–8 cases). Do not deep-dive edge cases.`,
  Edge: `Focus on EDGE CASE test cases: stress, boundary, and unusual input scenarios. Explore empty inputs, maximum lengths, special characters, unexpected data types, concurrent actions, and extreme values. Include boundary value analysis (BVA) and equivalence partitioning.`,
  Security: `Focus on SECURITY test cases: authentication, authorization, injection attacks (SQL, XSS, CSRF), session management, data exposure, rate limiting, and privilege escalation. Every test case must have a clear security control being validated.`,
  Custom: `Generate a COMPREHENSIVE FULL-SUITE of test cases covering: functional, regression, edge, boundary, security, and performance concerns. No restrictions on coverage depth — maximize quality and completeness.`,
};

export function buildJiraTestCasePrompt(
  context: JiraTicketContext | string,
  template: TestTemplate = 'Functional'
): string {
  const templateInstruction = TEMPLATE_INSTRUCTIONS[template];
  const jiraId = typeof context === 'string' ? 'DOC_IMPORT' : context.jiraId;

  let contextStr = '';
  if (typeof context === 'string') {
    contextStr = `## Requirement\n${context}`;
  } else {
    contextStr = `## Jira Ticket Details
- **Jira ID**: ${context.jiraId}
- **Summary**: ${context.summary}
- **Issue Type**: ${context.issueType || 'Not specified'}
- **Priority**: ${context.priority || 'Not specified'}
- **Status**: ${context.status || 'Not specified'}
${context.components?.length ? `- **Components**: ${context.components.join(', ')}` : ''}

## Description
${context.description || 'No description provided.'}

${context.acceptanceCriteria ? `## Acceptance Criteria\n${context.acceptanceCriteria}` : ''}`;
  }

  return `
You are a Staff-Level Quality Assurance Engineer with deep expertise in test design. Your task is to generate comprehensive, highly detailed test cases based on the following context.

## Template: ${template}
${templateInstruction}

Your output MUST read exactly like a meticulous human QA professional wrote it. Provide rich contextual preconditions, practical and expansive test data, and highly granular step-by-step instructions.

${contextStr}

---

You MUST output exactly a JSON array containing a MINIMUM of 5 test cases (more if needed for full coverage). Generate enough test cases to FULLY cover the scope defined by the template above.

Do NOT output any markdown, explanation, or prose — ONLY valid JSON.

Output format MUST be a direct JSON array of objects conforming to this strict schema:

[
  {
    "id": "TC_001",
    "title": "A highly descriptive, human-readable title",
    "type": "Positive | Negative | Edge | Boundary | Security",
    "priority": "P0 | P1 | P2",
    "preconditions": "String of very detailed preconditions required before testing",
    "steps": ["Step 1: very detailed action", "Step 2: very detailed action", "Step 3: ..."],
    "test_data": "String of realistic, specific test data (e.g. email='test@example.com', password='Test@1234')",
    "expected_result": "String of the precise expected outcome",
    "linked_jira_id": "${jiraId}"
  }
]
`.trim();
}
