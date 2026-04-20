import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.PROD || window.location.hostname !== 'localhost' ? '/api' : 'http://localhost:3001/api',
});

export const getSettings = async () => {
  const res = await api.get('/settings');
  return res.data;
};

export const saveSettings = async (settings: any) => {
  const res = await api.post('/settings', settings);
  return res.data;
};

export const generateTestCase = async (requirement: string, jiraTicket?: any, config?: any) => {
  const res = await api.post('/generate', { requirement, jiraTicket, config });
  return res.data;
};

export const fetchJiraTicket = async (jiraId: string, config?: any) => {
  const res = await api.post('/jira/fetch', { jiraId, config });
  return res.data;
};

export const uploadDocument = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

export const exportTestCases = async (testCases: any[], format: string, jiraId?: string) => {
  const res = await api.post('/testcases/export', { testCases, format, jiraId }, { responseType: 'blob' });
  return res.data;
};

export const testConnectionApi = async (provider: string, config: any) => {
  const res = await api.post('/test-connection', { provider, config });
  return res.data;
};
