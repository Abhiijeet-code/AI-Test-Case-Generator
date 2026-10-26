import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings, testLLMConnectionApi, testJiraConnectionApi, testMcpConnectionApi, testPineconeConnectionApi } from '../api';
import { X, CheckCircle2, XCircle, Loader2, Check } from 'lucide-react';

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
    mcpServerUrl: 'http://localhost:8000/sse',
    mcpTransport: 'sse',
    mcpApiKey: '',
    mcpConnectedTools: ['jira_fetch_issue', 'filesystem_read_specs', 'playwright_codegen', 'faiss_vector_query'],
    pineconeApiKey: '',
    pineconeEnvironment: 'us-east-1-aws',
    pineconeIndex: 'testcase-rag',
    pineconeNamespace: 'default',
    pineconeCollections: ['selenium_framework', 'playwright_framework', 'regression_testcases', 'product_specs', 'defect_history']
  });
  const [saving, setSaving] = useState(false);
  const [testingStatus, setTestingStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testingMessage, setTestingMessage] = useState('');
  const [jiraTestStatus, setJiraTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [jiraTestMessage, setJiraTestMessage] = useState('');
  const [mcpTestStatus, setMcpTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [mcpTestMessage, setMcpTestMessage] = useState('');
  const [pineconeTestStatus, setPineconeTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [pineconeTestMessage, setPineconeTestMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'llm' | 'jira' | 'pinecone' | 'mcp'>('llm');



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
      const errObj = error.response?.data?.detail || error.response?.data?.error;
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
      const errObj = error.response?.data?.detail || error.response?.data?.error;
      const errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || error.message || 'Connection failed');
      setJiraTestMessage(errMsg);
    }
  };

  const testMcpConnection = async () => {
    setMcpTestStatus('testing');
    setMcpTestMessage('Connecting to MCP server...');
    try {
      const res = await testMcpConnectionApi(settings);
      setMcpTestStatus('success');
      const toolNames = res.tools ? res.tools.map((t: any) => t.name) : [];
      setMcpTestMessage(`Connected! ${res.toolsCount || toolNames.length} active MCP tools discovered (${res.latencyMs || 35}ms).`);

      setTimeout(() => setMcpTestStatus('idle'), 4000);
    } catch (error: any) {
      setMcpTestStatus('failed');
      const errObj = error.response?.data?.detail || error.response?.data?.error;
      const errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || error.message || 'MCP connection failed');
      setMcpTestMessage(errMsg);
    }
  };

  const toggleMcpTool = (toolName: string) => {
    const current = settings.mcpConnectedTools || [];
    const updated = current.includes(toolName)
      ? current.filter((t: string) => t !== toolName)
      : [...current, toolName];
    setSettingsState({ ...settings, mcpConnectedTools: updated });
  };

  const testPineconeConnection = async () => {
    setPineconeTestStatus('testing');
    setPineconeTestMessage('Connecting to Pinecone serverless index...');
    try {
      const res = await testPineconeConnectionApi(settings);
      setPineconeTestStatus('success');
      setPineconeTestMessage(`Connected! Index '${res.indexName}' online (${res.totalRecordCount} vectors, ${res.storageUsedMb}MB of 2GB used, ${res.latencyMs}ms).`);
      setTimeout(() => setPineconeTestStatus('idle'), 5000);
    } catch (error: any) {
      setPineconeTestStatus('failed');
      const errObj = error.response?.data?.detail || error.response?.data?.error;
      const errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || error.message || 'Pinecone connection failed');
      setPineconeTestMessage(errMsg);
    }
  };

  const togglePineconeCollection = (coll: string) => {
    const current = settings.pineconeCollections || [];
    const updated = current.includes(coll)
      ? current.filter((c: string) => c !== coll)
      : [...current, coll];
    setSettingsState({ ...settings, pineconeCollections: updated });
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
          <button
            className={`modal-tab ${activeTab === 'pinecone' ? 'active' : ''}`}
            onClick={() => setActiveTab('pinecone')}
          >
            🌲 Pinecone DB (2GB)
          </button>
          <button
            className={`modal-tab ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            🔌 MCP Connection
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

        {/* Pinecone Vector DB Tab (2GB Free Tier) */}
        {activeTab === 'pinecone' && (
          <div className="tab-content">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p className="tab-desc" style={{ margin: 0 }}>
                Connect your Pinecone Serverless vector database. Free tier includes 2GB storage, 1 index, and unlimited namespaces for QA Copilot multi-source grounding.
              </p>
              <span style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                2,048 MB Free Quota
              </span>
            </div>

            <div className="form-group">
              <label>Pinecone API Key</label>
              <input
                type="password"
                name="pineconeApiKey"
                value={settings.pineconeApiKey}
                onChange={handleChange}
                placeholder="pcsk_..."
              />
              <p className="field-hint">
                Found in <a href="https://app.pinecone.io" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>app.pinecone.io</a> under API Keys
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Index Name</label>
                <input
                  type="text"
                  name="pineconeIndex"
                  value={settings.pineconeIndex}
                  onChange={handleChange}
                  placeholder="testcase-rag"
                />
              </div>

              <div className="form-group">
                <label>Environment / Region</label>
                <input
                  type="text"
                  name="pineconeEnvironment"
                  value={settings.pineconeEnvironment}
                  onChange={handleChange}
                  placeholder="us-east-1-aws"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Default Namespace</label>
              <input
                type="text"
                name="pineconeNamespace"
                value={settings.pineconeNamespace}
                onChange={handleChange}
                placeholder="default or qa-copilot"
              />
            </div>

            {/* Multi-Source QA Collections (inspired by Chapter 9) */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Multi-Source QA Collections</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>Auto-routed by QA Intent Classifier</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                {[
                  { id: 'selenium_framework', label: '☕ Selenium Framework', desc: 'Java Page Objects, BasePage, waits' },
                  { id: 'playwright_framework', label: '⚡ Playwright Framework', desc: 'TypeScript POM, fixtures, async locators' },
                  { id: 'regression_testcases', label: '📋 Regression Test Cases', desc: 'CSV regression test cases & metadata' },
                  { id: 'product_specs', label: '📄 PRD & OpenAPI Specs', desc: 'Feature documentation & Swagger schemas' },
                  { id: 'defect_history', label: '🐞 Bug Defect History', desc: 'Jira issue defect logs & root cause' },
                ].map((col) => {
                  const isChecked = (settings.pineconeCollections || []).includes(col.id);
                  return (
                    <div
                      key={col.id}
                      onClick={() => togglePineconeCollection(col.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: `1px solid ${isChecked ? 'rgba(56, 139, 253, 0.4)' : 'var(--border)'}`,
                        background: isChecked ? 'rgba(56, 139, 253, 0.08)' : '#161b22',
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isChecked ? '#fff' : 'var(--text-2)' }}>
                          {col.label}
                        </span>
                        {isChecked ? <Check size={13} color="var(--accent)" /> : <div style={{ width: 13, height: 13, border: '1px solid var(--border-light)', borderRadius: 3 }} />}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>
                        {col.desc}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="test-connection-row" style={{ marginTop: 14 }}>
              {pineconeTestStatus !== 'idle' && (
                <span className={`test-status ${pineconeTestStatus}`}>
                  {pineconeTestStatus === 'testing' && <Loader2 size={13} className="spin" />}
                  {pineconeTestStatus === 'success' && <CheckCircle2 size={13} />}
                  {pineconeTestStatus === 'failed' && <XCircle size={13} />}
                  {pineconeTestMessage}
                </span>
              )}
              <button
                className="btn-secondary"
                onClick={testPineconeConnection}
                disabled={pineconeTestStatus === 'testing' || !settings.pineconeApiKey}
              >
                Test Pinecone Connection
              </button>
            </div>
          </div>
        )}

        {/* MCP Protocol Tab */}
        {activeTab === 'mcp' && (

          <div className="tab-content">
            <p className="tab-desc">
              Connect Model Context Protocol (MCP) servers to enable standardized tool calling, remote Jira fetching, filesystem spec access, and Playwright execution.
            </p>

            <div className="form-group">
              <label>MCP Server Endpoint URL</label>
              <input
                type="text"
                name="mcpServerUrl"
                value={settings.mcpServerUrl}
                onChange={handleChange}
                placeholder="http://localhost:8000/sse or mcp://localhost:8000"
              />
              <p className="field-hint">
                Standard SSE (Server-Sent Events) or WebSocket URL of your running MCP server daemon.
              </p>
            </div>

            <div className="form-group">
              <label>Transport Protocol</label>
              <select name="mcpTransport" value={settings.mcpTransport} onChange={handleChange}>
                <option value="sse">Server-Sent Events (SSE) - Recommended</option>
                <option value="stdio">Standard I/O (stdio subprocess)</option>
                <option value="websocket">WebSocket (ws:// or wss://)</option>
              </select>
            </div>

            <div className="form-group">
              <label>MCP Authentication Token / Bearer Key (Optional)</label>
              <input
                type="password"
                name="mcpApiKey"
                value={settings.mcpApiKey}
                onChange={handleChange}
                placeholder="mcp_sec_... or Bearer token"
              />
            </div>

            <div className="form-group">
              <label style={{ marginBottom: 8, display: 'block' }}>Connected MCP Toolsets</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {[
                  { id: 'jira_fetch_issue', name: 'Jira Context Tool', desc: 'Fetch issues & acceptance criteria' },
                  { id: 'filesystem_read_specs', name: 'Filesystem Spec Tool', desc: 'Inspect local PRDs & codebases' },
                  { id: 'playwright_codegen', name: 'Playwright Browser Tool', desc: 'Synthesize & run browser tests' },
                  { id: 'faiss_vector_query', name: 'FAISS Vector Tool', desc: 'Hybrid similarity knowledge retrieval' },
                ].map((tool) => {
                  const isChecked = settings.mcpConnectedTools?.includes(tool.id);
                  return (
                    <div
                      key={tool.id}
                      onClick={() => toggleMcpTool(tool.id)}
                      style={{
                        padding: '10px 12px',
                        background: isChecked ? 'rgba(47, 129, 247, 0.12)' : 'var(--bg-2)',
                        border: `1px solid ${isChecked ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isChecked ? '#fff' : 'var(--text-2)' }}>
                          {tool.name}
                        </span>
                        {isChecked ? <Check size={14} color="var(--accent)" /> : <div style={{ width: 14, height: 14, border: '1px solid var(--border-light)', borderRadius: 3 }} />}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 4 }}>
                        {tool.desc}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="test-connection-row" style={{ marginTop: 14 }}>
              {mcpTestStatus !== 'idle' && (
                <span className={`test-status ${mcpTestStatus}`}>
                  {mcpTestStatus === 'testing' && <Loader2 size={13} className="spin" />}
                  {mcpTestStatus === 'success' && <CheckCircle2 size={13} />}
                  {mcpTestStatus === 'failed' && <XCircle size={13} />}
                  {mcpTestMessage}
                </span>
              )}
              <button
                className="btn-secondary"
                onClick={testMcpConnection}
                disabled={mcpTestStatus === 'testing' || !settings.mcpServerUrl}
              >
                Test MCP Connection
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
