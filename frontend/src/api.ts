import axios from 'axios';

// In production (Vercel experimentalServices), the backend is served at /_/backend
// Vercel strips the routePrefix before forwarding, so Express receives /api/... paths
// Full browser URL: /_/backend/api/...  →  Express sees: /api/...
const isProd = import.meta.env.PROD || window.location.hostname !== 'localhost';
const api = axios.create({
  baseURL: isProd ? '/_/backend/api' : 'http://localhost:3001/api',
});

export const getSettings = async () => {
  const res = await api.get('/settings');
  return res.data;
};

export const saveSettings = async (settings: any) => {
  const res = await api.post('/settings', settings);
  return res.data;
};

export const testLLMConnectionApi = async (provider: string, config: any) => {
  const res = await api.post('/test-connection', { provider, config });
  return res.data;
};

export const testJiraConnectionApi = async (config: any) => {
  const res = await api.post('/jira/test-connection', { config });
  return res.data;
};

export const fetchJiraTicket = async (jiraId: string, config?: any) => {
  const res = await api.post('/jira/fetch', { jiraId, config });
  return res.data;
};

export const generateTestCase = async (
  requirement: string,
  jiraTicket?: any,
  config?: any,
  template?: string,
  sessionDocId?: string
) => {
  const res = await api.post('/generate', { requirement, jiraTicket, config, template, sessionDocId });
  return res.data;
};

export const uploadDocument = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data; // Returns metadata only — no raw text
};

// Keep for backwards-compat (not used in production export — exports are client-side)
export const exportTestCasesApi = async (testCases: any[], format: string, jiraId?: string) => {
  const res = await api.post('/testcases/export', { testCases, format, jiraId }, { responseType: 'blob' });
  return res.data;
};

// Renamed export for backward compat
export const testConnectionApi = testLLMConnectionApi;
