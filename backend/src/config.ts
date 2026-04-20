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

export function getSettings(overrides?: Partial<AppSettings>): AppSettings {
  let settings = { ...defaultSettings };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      settings = { ...settings, ...JSON.parse(data) };
    }
  } catch (error) {
    // Expected on Vercel read-only filesystem if file skip
  }
  return { ...settings, ...overrides };
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...settings };
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  } catch (error) {
    console.warn('Could not persist settings to disk (expected on Vercel). Settings will be ephemeral.');
  }
  return updated;
}
