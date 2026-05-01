import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings, testLLMConnectionApi, testJiraConnectionApi } from '../api';
import { X, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettingsState] = useState({
    activeProvider: 'ollama',
    ollamaUrl: '',
    ollamaModel: '',
    groqApiKey: '',
    groqModel: 'llama-3.3-70b-versatile',
    openAiApiKey: '',
    claudeApiKey: '',
    geminiApiKey: '',
    geminiModel: 'gemini-3.1-pro-preview',
    lmStudioUrl: '',
    jiraBaseUrl: '',
    jiraEmail: '',
    jiraApiToken: '',
  });
  const [saving, setSaving] = useState(false);
  const [testingStatus, setTestingStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testingMessage, setTestingMessage] = useState('');
  const [jiraTestStatus, setJiraTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [jiraTestMessage, setJiraTestMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'llm' | 'jira'>('llm');

  useEffect(() => {
    // Load from localStorage first (primary source on Vercel)
    try {
      const local = localStorage.getItem('appSettings');
      if (local) {
        const parsed = JSON.parse(local);
        setSettingsState((prev) => ({ ...prev, ...parsed }));
      }
    } catch (e) {}
    // Try backend as secondary source (only on self-hosted deployments)
    getSettings().then((data) => {
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        // Only use backend values if localStorage doesn't already have them
        setSettingsState((prev) => {
          const localHasValues = Object.values(prev).some(v => v !== '');
          return localHasValues ? prev : { ...prev, ...data };
        });
      }
    }).catch(() => { /* expected on Vercel - settings are localStorage-only */ });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSettingsState({ ...settings, [e.target.name]: e.target.value });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(settings);
    } catch (error) {
      console.error('Backend save failed (expected on Vercel):', error);
    } finally {
      // Always save locally to ensure persistence in serverless environments
      localStorage.setItem('appSettings', JSON.stringify(settings));
      if ((window as any).onSettingsUpdate) {
        (window as any).onSettingsUpdate(settings);
      }
      setSaving(false);
      onClose();
    }
  };

  const testConnection = async () => {
    setTestingStatus('testing');
    setTestingMessage('Testing connection...');
    try {
      await testLLMConnectionApi(settings.activeProvider, settings);
      setTestingStatus('success');
      setTestingMessage('Connection successful!');
      setTimeout(() => setTestingStatus('idle'), 3000);
    } catch (error: any) {
      setTestingStatus('failed');
      const errObj = error.response?.data?.error;
      const errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || error.message || 'Connection failed');
      setTestingMessage(errMsg);
    }
  };

  const testJiraConnection = async () => {
    setJiraTestStatus('testing');
    setJiraTestMessage('Testing Jira connection...');
    try {
      await testJiraConnectionApi(settings);
      setJiraTestStatus('success');
      setJiraTestMessage('Jira connection successful!');
      setTimeout(() => setJiraTestStatus('idle'), 3000);
    } catch (error: any) {
      setJiraTestStatus('failed');
      const errObj = error.response?.data?.error;
      const errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || error.message || 'Connection failed');
      setJiraTestMessage(errMsg);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configuration Settings</h2>
          <button className="btn-icon modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          <button
            className={`modal-tab ${activeTab === 'llm' ? 'active' : ''}`}
            onClick={() => setActiveTab('llm')}
          >
            🤖 LLM Provider
          </button>
          <button
            className={`modal-tab ${activeTab === 'jira' ? 'active' : ''}`}
            onClick={() => setActiveTab('jira')}
          >
            🔵 Jira Integration
          </button>
        </div>

        {/* LLM Tab */}
        {activeTab === 'llm' && (
          <div className="tab-content">
            <div className="form-group">
              <label>Active Provider</label>
              <select name="activeProvider" value={settings.activeProvider} onChange={handleChange}>
                <option value="ollama">Ollama (Local)</option>
                <option value="lmstudio">LM Studio (Local)</option>
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>

            {settings.activeProvider === 'ollama' && (
              <>
                <div className="form-group">
                  <label>Ollama URL</label>
                  <input type="text" name="ollamaUrl" value={settings.ollamaUrl} onChange={handleChange} placeholder="http://localhost:11434" />
                </div>
                <div className="form-group">
                  <label>Model Name</label>
                  <input type="text" name="ollamaModel" value={settings.ollamaModel} onChange={handleChange} placeholder="llama3" />
                </div>
              </>
            )}

            {settings.activeProvider === 'groq' && (
              <>
                <div className="form-group">
                  <label>Groq API Key</label>
                  <input type="password" name="groqApiKey" value={settings.groqApiKey} onChange={handleChange} placeholder="gsk_..." />
                </div>
                <div className="form-group">
                  <label>Model</label>
                  <select name="groqModel" value={settings.groqModel} onChange={handleChange}>
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile (recommended)</option>
                    <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant (fast)</option>
                    <option value="llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B</option>
                    <option value="openai/gpt-oss-120b">GPT-OSS 120B (best reasoning)</option>
                    <option value="openai/gpt-oss-20b">GPT-OSS 20B</option>
                  </select>
                </div>
              </>
            )}

            {settings.activeProvider === 'openai' && (
              <div className="form-group">
                <label>OpenAI API Key</label>
                <input type="password" name="openAiApiKey" value={settings.openAiApiKey} onChange={handleChange} placeholder="sk-..." />
              </div>
            )}

            {settings.activeProvider === 'claude' && (
              <div className="form-group">
                <label>Claude API Key</label>
                <input type="password" name="claudeApiKey" value={settings.claudeApiKey} onChange={handleChange} placeholder="sk-ant-..." />
              </div>
            )}

            {settings.activeProvider === 'gemini' && (
              <>
                <div className="form-group">
                  <label>Gemini API Key</label>
                  <input type="password" name="geminiApiKey" value={settings.geminiApiKey} onChange={handleChange} placeholder="AIza..." />
                </div>
                <div className="form-group">
                  <label>Model <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>(auto-fallback if overloaded)</span></label>
                  <select name="geminiModel" value={settings.geminiModel} onChange={handleChange}>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (best, default)</option>
                    <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  </select>
                </div>
              </>
            )}

            {settings.activeProvider === 'lmstudio' && (
              <div className="form-group">
                <label>LM Studio URL</label>
                <input type="text" name="lmStudioUrl" value={settings.lmStudioUrl} onChange={handleChange} placeholder="http://localhost:1234" />
              </div>
            )}

            <div className="test-connection-row">
              {testingStatus !== 'idle' && (
                <span className={`test-status ${testingStatus}`}>
                  {testingStatus === 'testing' && <Loader2 size={13} className="spin" />}
                  {testingStatus === 'success' && <CheckCircle2 size={13} />}
                  {testingStatus === 'failed' && <XCircle size={13} />}
                  {testingMessage}
                </span>
              )}
              <button
                className="btn-secondary"
                onClick={testConnection}
                disabled={testingStatus === 'testing'}
              >
                Test Connection
              </button>
            </div>
          </div>
        )}

        {/* Jira Tab */}
        {activeTab === 'jira' && (
          <div className="tab-content">
            <p className="tab-desc">
              Connect your Jira instance to automatically fetch ticket content when you enter a Jira ID.
            </p>
            <div className="form-group">
              <label>Jira Base URL</label>
              <input
                type="text"
                name="jiraBaseUrl"
                value={settings.jiraBaseUrl}
                onChange={handleChange}
                placeholder="https://yourcompany.atlassian.net"
              />
            </div>
            <div className="form-group">
              <label>Jira Email</label>
              <input
                type="email"
                name="jiraEmail"
                value={settings.jiraEmail}
                onChange={handleChange}
                placeholder="you@company.com"
              />
            </div>
            <div className="form-group">
              <label>Jira API Token</label>
              <input
                type="password"
                name="jiraApiToken"
                value={settings.jiraApiToken}
                onChange={handleChange}
                placeholder="Your Atlassian API token"
              />
              <p className="field-hint">
                Generate from <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)' }}>Atlassian Account Settings</a>
              </p>
            </div>
            <div className="test-connection-row">
              {jiraTestStatus !== 'idle' && (
                <span className={`test-status ${jiraTestStatus}`}>
                  {jiraTestStatus === 'testing' && <Loader2 size={13} className="spin" />}
                  {jiraTestStatus === 'success' && <CheckCircle2 size={13} />}
                  {jiraTestStatus === 'failed' && <XCircle size={13} />}
                  {jiraTestMessage}
                </span>
              )}
              <button
                className="btn-secondary"
                onClick={testJiraConnection}
                disabled={jiraTestStatus === 'testing' || !settings.jiraBaseUrl || !settings.jiraEmail || !settings.jiraApiToken}
              >
                Test Jira Connection
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
