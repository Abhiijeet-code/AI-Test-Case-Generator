import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import multer from 'multer';
import mammoth from 'mammoth';
const pdfParse = require('pdf-parse');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

import { getSettings, saveSettings } from './config';
import { generateTestCase } from './llmClient';
import { buildJiraTestCasePrompt, JiraTicketContext } from './promptBuilder';

// Settings route
app.get('/api/settings', (req: Request, res: Response) => {
  res.json(getSettings());
});

app.post('/api/settings', (req: Request, res: Response) => {
  const updated = saveSettings(req.body);
  res.json({ status: 'ok', message: 'Settings saved', settings: updated });
});

import { testLLMConnection } from './llmClient';

app.post('/api/test-connection', async (req: Request, res: Response) => {
  const { provider, config } = req.body;
  try {
    await testLLMConnection(provider, config);
    res.json({ status: 'ok', message: 'Connection successful' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Connection failed' });
  }
});

// ─── Jira Fetch Endpoint ────────────────────────────────────────────────────
app.post('/api/jira/fetch', async (req: Request, res: Response) => {
  const { jiraId } = req.body;

  if (!jiraId) {
    return res.status(400).json({ error: 'jiraId is required' });
  }

  const settings = getSettings();
  const { jiraBaseUrl, jiraEmail, jiraApiToken } = settings;

  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    return res.status(400).json({
      error: 'Jira is not configured. Please set Jira URL, email, and API token in Settings.'
    });
  }

  try {
    const cleanBase = jiraBaseUrl.replace(/\/$/, '');
    const jiraUrl = `${cleanBase}/rest/api/3/issue/${jiraId}`;

    const response = await axios.get(jiraUrl, {
      auth: {
        username: jiraEmail,
        password: jiraApiToken,
      },
      headers: { Accept: 'application/json' },
    });

    const fields = response.data.fields;

    // Extract plain text from Atlassian Document Format (ADF)
    const extractText = (adfOrString: any): string => {
      if (!adfOrString) return '';
      if (typeof adfOrString === 'string') return adfOrString;
      // ADF has a "content" array
      if (adfOrString.content) {
        return adfOrString.content
          .map((node: any) => extractText(node))
          .join('\n')
          .trim();
      }
      if (adfOrString.text) return adfOrString.text;
      return '';
    };

    const description = extractText(fields.description);

    // Try to find acceptance criteria in custom fields or description
    let acceptanceCriteria = '';
    const acField = fields.customfield_10016 || fields.customfield_10017 || fields.customfield_10056;
    if (acField) {
      acceptanceCriteria = extractText(acField);
    }

    const ticket: JiraTicketContext = {
      jiraId,
      summary: fields.summary || '',
      description,
      priority: fields.priority?.name || '',
      status: fields.status?.name || '',
      acceptanceCriteria,
    };

    res.json({ status: 'ok', ticket });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 401) {
      return res.status(401).json({ error: 'Jira authentication failed. Check your email and API token.' });
    }
    if (status === 404) {
      return res.status(404).json({ error: `Jira issue "${jiraId}" not found.` });
    }
    res.status(500).json({ error: err.message || 'Failed to fetch Jira ticket.' });
  }
});

// ─── Generate Test Cases ────────────────────────────────────────────────────
app.post('/api/generate', async (req: Request, res: Response) => {
  const { requirement, jiraTicket } = req.body;

  if (!requirement && !jiraTicket) {
    return res.status(400).json({ error: 'requirement or jiraTicket is required' });
  }

  try {
    const prompt = jiraTicket
      ? buildJiraTestCasePrompt(jiraTicket as JiraTicketContext)
      : buildJiraTestCasePrompt(requirement as string);

    let testCases;
    let attempts = 0;
    while (attempts < 2) {
      let rawResponse = await generateTestCase(prompt);
      if (rawResponse.startsWith('```json')) {
        rawResponse = rawResponse.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (rawResponse.startsWith('```')) {
        rawResponse = rawResponse.replace(/^```[a-z]*/, '').replace(/```$/, '').trim();
      }
      
      try {
        testCases = JSON.parse(rawResponse);
        if (Array.isArray(testCases) && testCases.length >= 5) {
          break; // Success
        } else {
          console.warn(`LLM returned ${testCases?.length || 0} cases. Retrying...`);
          testCases = null;
        }
      } catch (e) {
        console.warn('LLM did not return strict JSON. Retrying...');
      }
      attempts++;
    }

    if (!testCases || testCases.length < 5) {
      if (!testCases) {
        return res.status(500).json({ error: 'LLM failed to generate a valid JSON format after retries.' });
      }
      // If we got some test cases but fewer than 5, still return them but maybe throw a warning
      res.json({ status: 'warning', message: 'Fewer than 5 test cases generated', response: testCases });
      return;
    }

    res.json({ status: 'ok', response: testCases });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate test cases.' });
  }
});

// ─── Document Upload ────────────────────────────────────────────────────────
app.post('/api/documents/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    
    const { originalname, buffer, mimetype } = req.file;
    let text = '';

    if (mimetype === 'application/pdf' || originalname.endsWith('.pdf')) {
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || originalname.endsWith('.docx')) {
      const data = await mammoth.extractRawText({ buffer });
      text = data.value;
    } else if (mimetype === 'text/plain' || originalname.endsWith('.txt') || originalname.endsWith('.md')) {
      text = buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Please upload PDF, DOCX, TXT, or MD.' });
    }

    // Truncate if document is extremely large (e.g., > 100k characters ≈ 25k tokens) to avoid LLM crash
    const MAX_CHARS = 100000;
    const isTruncated = text.length > MAX_CHARS;
    if (isTruncated) {
      text = text.substring(0, MAX_CHARS) + '\n...[Document Truncated]';
    }

    res.json({ status: 'ok', text, originalname, isTruncated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to parse document.' });
  }
});

// ─── Export Test Cases ──────────────────────────────────────────────────────
app.post('/api/testcases/export', async (req: Request, res: Response) => {
  const { testCases, format, jiraId } = req.body;
  if (!testCases || !Array.isArray(testCases)) {
    return res.status(400).json({ error: 'Valid test cases array required.' });
  }

  const filenameId = jiraId || 'custom';
  const timestamp = new Date().toISOString().split('T')[0];

  try {
    if (format === 'csv') {
      let csv = 'ID,Title,Type,Priority,Preconditions,Steps,Test Data,Expected Result\n';
      testCases.forEach((tc) => {
        const escape = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
        const steps = escape(Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps);
        csv += `${escape(tc.id)},${escape(tc.title)},${escape(tc.type)},${escape(tc.priority)},${escape(tc.preconditions)},${steps},${escape(tc.test_data)},${escape(tc.expected_result)}\n`;
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
        steps.forEach((s: string, i: number) => md += `${i + 1}. ${s}\n`);
        md += `\n**Expected Result**: ${tc.expected_result}\n\n---\n\n`;
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
