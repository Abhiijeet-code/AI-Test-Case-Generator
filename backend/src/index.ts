import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import multer from 'multer';
import mammoth from 'mammoth';
import crypto from 'crypto';
const pdfParse = require('pdf-parse');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── In-Memory Document Session Store ────────────────────────────────────────
// Maps sessionDocId → extracted text. Held in memory per process, never written to disk.
const docSessionStore = new Map<string, string>();

// ─── Middleware ───────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});
app.use(cors());
app.use(express.json({ limit: '2mb' }));

import { getSettings, saveSettings } from './config';
import { generateTestCase } from './llmClient';
import { buildJiraTestCasePrompt, JiraTicketContext, TestTemplate } from './promptBuilder';
import { testLLMConnection } from './llmClient';

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', (_req: Request, res: Response) => {
  res.json(getSettings());
});

app.post('/api/settings', (req: Request, res: Response) => {
  const updated = saveSettings(req.body);
  res.json({ status: 'ok', message: 'Settings saved', settings: updated });
});

// ─── LLM Test Connection ──────────────────────────────────────────────────────
app.post('/api/test-connection', async (req: Request, res: Response) => {
  const { provider, config } = req.body;
  try {
    await testLLMConnection(provider, config);
    res.json({ status: 'ok', message: 'Connection successful' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Connection failed' });
  }
});

// ─── Jira Test Connection ─────────────────────────────────────────────────────
app.post('/api/jira/test-connection', async (req: Request, res: Response) => {
  const { config } = req.body;
  const settings = getSettings(config);
  const { jiraBaseUrl, jiraEmail, jiraApiToken } = settings;

  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    return res.status(400).json({ error: 'Jira URL, email, and API token are all required.' });
  }

  try {
    const cleanBase = jiraBaseUrl.replace(/\/$/, '');
    // Use the /myself endpoint to validate credentials
    await axios.get(`${cleanBase}/rest/api/3/myself`, {
      auth: { username: jiraEmail, password: jiraApiToken },
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });
    res.json({ status: 'ok', message: 'Jira connection successful' });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 401) return res.status(401).json({ error: 'Authentication failed. Check your email and API token.' });
    if (status === 403) return res.status(403).json({ error: 'Forbidden. Your account may lack API access.' });
    res.status(500).json({ error: err.message || 'Failed to connect to Jira.' });
  }
});

// ─── Jira Fetch Issue ─────────────────────────────────────────────────────────
app.post('/api/jira/fetch', async (req: Request, res: Response) => {
  const { jiraId, config } = req.body;

  if (!jiraId) return res.status(400).json({ error: 'jiraId is required' });

  const settings = getSettings(config);
  const { jiraBaseUrl, jiraEmail, jiraApiToken } = settings;

  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    return res.status(400).json({
      error: 'Jira is not configured. Please set Jira URL, email, and API token in Settings.',
    });
  }

  try {
    const cleanBase = jiraBaseUrl.replace(/\/$/, '');
    const jiraUrl = `${cleanBase}/rest/api/3/issue/${jiraId}`;

    const response = await axios.get(jiraUrl, {
      auth: { username: jiraEmail, password: jiraApiToken },
      headers: { Accept: 'application/json' },
      timeout: 15000,
    });

    const fields = response.data.fields;

    // Extract plain text from Atlassian Document Format (ADF)
    const extractText = (adfOrString: any): string => {
      if (!adfOrString) return '';
      if (typeof adfOrString === 'string') return adfOrString;
      if (adfOrString.content) {
        return adfOrString.content.map((node: any) => extractText(node)).join('\n').trim();
      }
      if (adfOrString.text) return adfOrString.text;
      return '';
    };

    const description = extractText(fields.description);
    let acceptanceCriteria = '';
    const acField = fields.customfield_10016 || fields.customfield_10017 || fields.customfield_10056;
    if (acField) acceptanceCriteria = extractText(acField);

    // Extract components
    const components: string[] = (fields.components || []).map((c: any) => c.name).filter(Boolean);

    const ticket: JiraTicketContext = {
      jiraId,
      summary: fields.summary || '',
      description,
      priority: fields.priority?.name || '',
      status: fields.status?.name || '',
      issueType: fields.issuetype?.name || '',
      components,
      acceptanceCriteria,
    };

    res.json({ status: 'ok', ticket });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 401) return res.status(401).json({ error: 'Jira authentication failed. Check your email and API token.' });
    if (status === 404) return res.status(404).json({ error: `Jira issue "${jiraId}" not found.` });
    res.status(500).json({ error: err.message || 'Failed to fetch Jira ticket.' });
  }
});

// ─── Generate Test Cases ──────────────────────────────────────────────────────
app.post('/api/generate', async (req: Request, res: Response) => {
  const { requirement, jiraTicket, config, template, sessionDocId } = req.body;

  // Resolve the requirement source
  let requirementText: string | JiraTicketContext | null = null;

  if (jiraTicket) {
    requirementText = jiraTicket as JiraTicketContext;
  } else if (sessionDocId && docSessionStore.has(sessionDocId)) {
    // Server-side doc text — never sent to frontend
    const docText = docSessionStore.get(sessionDocId)!;
    requirementText = requirement ? `${requirement}\n\n${docText}` : docText;
  } else if (requirement) {
    requirementText = requirement as string;
  }

  if (!requirementText) {
    return res.status(400).json({ error: 'No requirement source provided. Enter text, a Jira ID, or import a document.' });
  }

  const settings = getSettings(config);
  const chosenTemplate: TestTemplate = (template as TestTemplate) || 'Functional';

  try {
    const prompt = buildJiraTestCasePrompt(requirementText as any, chosenTemplate);

    let testCases;
    let attempts = 0;
    while (attempts < 2) {
      let rawResponse = await generateTestCase(prompt, settings);
      // Strip any markdown fences
      rawResponse = rawResponse.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      // Sometimes models return {...} instead of [{...}] — wrap if needed
      if (rawResponse.startsWith('{')) rawResponse = `[${rawResponse}]`;

      try {
        testCases = JSON.parse(rawResponse);
        if (Array.isArray(testCases) && testCases.length >= 5) break;
        console.warn(`LLM returned ${testCases?.length || 0} cases (template: ${chosenTemplate}). Retrying...`);
        testCases = null;
      } catch (e) {
        console.warn('LLM did not return valid JSON. Retrying...');
      }
      attempts++;
    }

    if (!testCases) {
      return res.status(500).json({ error: 'LLM failed to generate valid JSON after retries.' });
    }

    if (testCases.length < 5) {
      res.json({ status: 'warning', message: `Only ${testCases.length} test cases generated`, response: testCases });
      return;
    }

    res.json({ status: 'ok', response: testCases });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate test cases.' });
  }
});

// ─── Document Upload ──────────────────────────────────────────────────────────
// Returns METADATA ONLY — raw extracted text is stored server-side in docSessionStore
app.post('/api/documents/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { originalname, buffer, mimetype } = req.file;
    const sizeBytes = buffer.length;
    const ext = originalname.split('.').pop()?.toLowerCase() || '';

    let text = '';
    let pageCount: number | undefined;
    let ocrApplied = false;
    const warnings: string[] = [];

    // ── Parse by type ──
    if (mimetype === 'application/pdf' || ext === 'pdf') {
      const data = await pdfParse(buffer);
      text = data.text || '';
      pageCount = data.numpages;
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      const data = await mammoth.extractRawText({ buffer });
      text = data.value;
      if (data.messages?.length) {
        warnings.push(...data.messages.slice(0, 3).map((m: any) => m.message));
      }
    } else if (mimetype === 'text/plain' || ext === 'txt' || ext === 'md') {
      text = buffer.toString('utf-8');
    } else if (ext === 'csv') {
      text = buffer.toString('utf-8');
    } else if (ext === 'html' || ext === 'htm') {
      // Basic HTML tag strip
      text = buffer.toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (ext === 'rtf') {
      // Basic RTF strip: remove control words
      text = buffer.toString('ascii').replace(/\{[^}]*\}|\\[a-z]+\d*\s?|[{}\\]/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      return res.status(400).json({
        error: 'Unsupported file type. Supported: PDF, DOCX, TXT, MD, CSV, HTML, RTF.',
      });
    }

    if (!text || text.trim().length < 10) {
      return res.status(422).json({ error: 'Could not extract text from this file. Try a different format.' });
    }

    // ── Truncation ──
    const MAX_CHARS = 80000; // ~20k tokens
    let truncated = false;
    if (text.length > MAX_CHARS) {
      text = text.substring(0, MAX_CHARS);
      truncated = true;
      warnings.push(`Document truncated at ~${Math.round(MAX_CHARS / 5)} words to fit model context window.`);
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // ── Store text server-side, return only metadata ──
    const sessionDocId = crypto.randomUUID();
    docSessionStore.set(sessionDocId, text);

    // Clean up old entries if store grows too large (keep max 50)
    if (docSessionStore.size > 50) {
      const firstKey = docSessionStore.keys().next().value;
      if (firstKey) docSessionStore.delete(firstKey);
    }

    res.json({
      status: 'ok',
      sessionDocId,       // ← frontend uses this token to reference the stored text
      originalname,
      sizeBytes,
      wordCount,
      pageCount,
      detectedFormat: ext.toUpperCase(),
      ocrApplied,
      truncated,
      warnings,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to parse document.' });
  }
});

// ─── Export Test Cases (server-side fallback) ─────────────────────────────────
app.post('/api/testcases/export', async (req: Request, res: Response) => {
  const { testCases, format, jiraId } = req.body;
  if (!testCases || !Array.isArray(testCases)) {
    return res.status(400).json({ error: 'Valid test cases array required.' });
  }

  const filenameId = jiraId || 'custom';
  const timestamp = new Date().toISOString().split('T')[0];

  try {
    if (format === 'csv') {
      const escape = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
      let csv = 'ID,Title,Type,Priority,Preconditions,Steps,Test Data,Expected Result,Linked Jira ID\n';
      testCases.forEach((tc) => {
        const steps = escape(Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps);
        csv += `${escape(tc.id)},${escape(tc.title)},${escape(tc.type)},${escape(tc.priority)},${escape(tc.preconditions)},${steps},${escape(tc.test_data)},${escape(tc.expected_result)},${escape(tc.linked_jira_id)}\n`;
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameId}_test_cases_${timestamp}.csv"`);
      return res.send(csv);
    }

    if (format === 'md') {
      let md = `# Test Cases for ${jiraId || 'Requirement'}\n\n`;
      testCases.forEach((tc) => {
        md += `### ${tc.id}: ${tc.title}\n`;
        md += `- **Type**: ${tc.type}\n- **Priority**: ${tc.priority}\n`;
        md += `\n**Preconditions**: ${tc.preconditions}\n\n**Steps**:\n`;
        const steps = Array.isArray(tc.steps) ? tc.steps : String(tc.steps).split('\n');
        steps.forEach((s: string, i: number) => (md += `${i + 1}. ${s}\n`));
        md += `\n**Test Data**: ${tc.test_data}\n\n**Expected Result**: ${tc.expected_result}\n\n---\n\n`;
      });
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameId}_test_cases_${timestamp}.md"`);
      return res.send(md);
    }

    return res.status(400).json({ error: `Unsupported export format: ${format}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Export failed.' });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export default app;
