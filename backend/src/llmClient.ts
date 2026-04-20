import axios from 'axios';
import { getSettings } from './config';

export async function generateTestCase(prompt: string, passedSettings?: any): Promise<string> {
  const settings = passedSettings || getSettings();
  const provider = settings.activeProvider;

  try {
    switch (provider) {
      case 'ollama':
        return await callOllama(prompt, settings);
      case 'groq':
        return await callGroq(prompt, settings);
      case 'openai':
        return await callOpenAI(prompt, settings);
      case 'claude':
        return await callClaude(prompt, settings);
      case 'gemini':
        return await callGemini(prompt, settings);
      case 'lmstudio':
        return await callLMStudio(prompt, settings);
      default:
        throw new Error(`Unknown provider: ${provider}. Please configure a valid provider in Settings.`);
    }
  } catch (error: any) {
    const errData = error.response?.data;
    const msg = errData?.error?.message || errData?.error?.status || errData?.error || errData?.message || error.message || 'Unknown error';
    console.error(`Error with provider ${provider}:`, typeof msg === 'string' ? msg : JSON.stringify(msg));
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
}

export async function testLLMConnection(provider: string, config: any): Promise<boolean> {
  const prompt = "Say 'Hello'. Just say Hello.";
  try {
    switch (provider) {
      case 'ollama':
        await callOllama(prompt, config);
        return true;
      case 'groq':
        await callGroq(prompt, config);
        return true;
      case 'openai':
        await callOpenAI(prompt, config);
        return true;
      case 'claude':
        await callClaude(prompt, config);
        return true;
      case 'gemini':
        await callGemini(prompt, config);
        return true;
      case 'lmstudio':
        await callLMStudio(prompt, config);
        return true;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error: any) {
    const errData = error.response?.data;
    const msg = errData?.error?.message || errData?.error?.status || errData?.error || errData?.message || error.message || 'Connection failed';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
}

// ─── Ollama (Local) ─────────────────────────────────────────────
async function callOllama(prompt: string, settings: any): Promise<string> {
  const url = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const response = await axios.post(`${url}/api/generate`, {
    model: settings.ollamaModel || 'llama3',
    prompt: prompt,
    stream: false,
  }, { timeout: 120000 });
  return response.data.response;
}

// ─── Groq ───────────────────────────────────────────────────────
async function callGroq(prompt: string, settings: any): Promise<string> {
  if (!settings.groqApiKey) throw new Error('Groq API key is not configured. Go to Settings to add it.');
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: settings.groqModel || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${settings.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );
  return response.data.choices[0].message.content;
}

// ─── OpenAI ─────────────────────────────────────────────────────
async function callOpenAI(prompt: string, settings: any): Promise<string> {
  if (!settings.openAiApiKey) throw new Error('OpenAI API key is not configured. Go to Settings to add it.');
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${settings.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );
  return response.data.choices[0].message.content;
}

// ─── Claude (Anthropic) ─────────────────────────────────────────
async function callClaude(prompt: string, settings: any): Promise<string> {
  if (!settings.claudeApiKey) throw new Error('Claude API key is not configured. Go to Settings to add it.');
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': settings.claudeApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    }
  );
  // Anthropic returns content blocks
  const blocks = response.data.content;
  return blocks.map((b: any) => b.text).join('');
}

// ─── Gemini (Google) ─── with automatic model fallback ──────────
const GEMINI_FALLBACK_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

async function callGeminiModel(prompt: string, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await axios.post(
    url,
    { contents: [{ parts: [{ text: prompt }] }] },
    { headers: { 'Content-Type': 'application/json' }, timeout: 90000 }
  );
  const candidates = response.data.candidates;
  if (!candidates || candidates.length === 0) throw new Error('Gemini returned no response. The model may have filtered the content.');
  return candidates[0].content.parts.map((p: any) => p.text).join('');
}

async function callGemini(prompt: string, settings: any): Promise<string> {
  if (!settings.geminiApiKey) throw new Error('Gemini API key is not configured. Go to Settings to add it.');

  const preferredModel = settings.geminiModel || GEMINI_FALLBACK_MODELS[0];
  const modelsToTry = [preferredModel, ...GEMINI_FALLBACK_MODELS.filter((m: string) => m !== preferredModel)];

  let lastError: any;
  for (const model of modelsToTry) {
    try {
      console.log(`Trying Gemini model: ${model}`);
      return await callGeminiModel(prompt, settings.geminiApiKey, model);
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 503 || status === 429 || status === 500) {
        console.warn(`Gemini model ${model} unavailable (${status}), trying next...`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ─── LM Studio (Local, OpenAI-compatible) ───────────────────────
async function callLMStudio(prompt: string, settings: any): Promise<string> {
  const url = (settings.lmStudioUrl || 'http://localhost:1234').replace(/\/$/, '');
  const response = await axios.post(
    `${url}/v1/chat/completions`,
    {
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );
  return response.data.choices[0].message.content;
}
