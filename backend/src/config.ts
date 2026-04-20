import fs from 'fs';
import path from 'path';

const SETTINGS_FILE = path.join(__dirname, '../../settings.json');

export interface AppSettings {
  ollamaUrl: string;
  ollamaModel: string;
  groqApiKey: string;
  openAiApiKey: string;
  claudeApiKey: string;
  geminiApiKey: string;
  lmStudioUrl: string;
  activeProvider: 'ollama' | 'groq' | 'openai' | 'claude' | 'gemini' | 'lmstudio';
  // Jira integration
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  // Model overrides
  geminiModel: string;
  groqModel: string;
}

const defaultSettings: AppSettings = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  groqApiKey: '',
  openAiApiKey: '',
  claudeApiKey: '',
  geminiApiKey: '',
  lmStudioUrl: 'http://localhost:1234',
  activeProvider: 'ollama',
  jiraBaseUrl: '',
  jiraEmail: '',
  jiraApiToken: '',
  geminiModel: 'gemini-3.1-pro-preview',
  groqModel: 'llama-3.3-70b-versatile',
};

export function getSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Error reading settings', error);
  }
  return defaultSettings;
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...settings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
