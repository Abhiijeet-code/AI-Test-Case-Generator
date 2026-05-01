import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Send, ExternalLink, AlertCircle, CheckCircle2, Loader2, Tag, ChevronDown, ChevronUp, FileUp, Download, Copy, ClipboardCheck } from 'lucide-react';
import * as XLSX from 'xlsx';
import Sidebar from './components/Sidebar';
import type { ChatSession } from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import { generateTestCase, fetchJiraTicket, uploadDocument } from './api';

type TestTemplate = 'Functional' | 'Regression' | 'Smoke' | 'Edge' | 'Security' | 'Custom';
const TEMPLATES: TestTemplate[] = ['Functional', 'Regression', 'Smoke', 'Edge', 'Security', 'Custom'];

// Jira ID pattern: PROJECT-123
const JIRA_ID_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

interface JiraTicket {
  jiraId: string;
  summary: string;
  description: string;
  priority?: string;
  status?: string;
  issueType?: string;
  components?: string[];
  acceptanceCriteria?: string;
}

export interface TestCase {
  id: string;
  title: string;
  type: string;
  priority: string;
  preconditions: string;
  steps: string[] | string;
  test_data: string;
  expected_result: string;
  linked_jira_id: string;
}

interface Message {
  role: 'user' | 'ai' | 'jira-ticket' | 'error';
  content: string;
  jiraTicket?: JiraTicket;
  testCases?: TestCase[];
}

function JiraTicketCard({ ticket }: { ticket: JiraTicket }) {
  const [expanded, setExpanded] = useState(false);

  const priorityColor: Record<string, string> = {
    Highest: '#f85149',
    High: '#ff7b72',
    Medium: '#e3b341',
    Low: '#3fb950',
    Lowest: '#8b949e',
  };

  const color = priorityColor[ticket.priority || ''] || '#8b949e';

  return (
    <div className="jira-card">
      <div className="jira-card-header">
        <div className="jira-card-id">
          <Tag size={14} />
          <span>{ticket.jiraId}</span>
        </div>
        <div className="jira-card-badges">
          {ticket.issueType && (
            <span className="badge" style={{ color: '#79c0ff', borderColor: '#79c0ff', backgroundColor: '#79c0ff18' }}>
              {ticket.issueType}
            </span>
          )}
          {ticket.priority && (
            <span className="badge" style={{ color, borderColor: color, backgroundColor: `${color}18` }}>
              {ticket.priority}
            </span>
          )}
          {ticket.status && (
            <span className="badge status-badge">{ticket.status}</span>
          )}
          {ticket.components?.map((c) => (
            <span key={c} className="badge" style={{ color: '#a371f7', borderColor: '#a371f7', backgroundColor: '#a371f718' }}>{c}</span>
          ))}
        </div>
      </div>
      <h3 className="jira-card-summary">{ticket.summary}</h3>
      {ticket.description && (
        <>
          <div className={`jira-card-description ${expanded ? 'expanded' : ''}`}>
            {ticket.description}
          </div>
          {ticket.description.length > 200 && (
            <button className="toggle-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? <><ChevronUp size={14} /> Show less</> : <><ChevronDown size={14} /> Show more</>}
            </button>
          )}
        </>
      )}
      <div className="jira-card-footer">
        <CheckCircle2 size={13} />
        <span>Ticket fetched — generating test cases...</span>
      </div>
    </div>
  );
}

function formatTestCases(content: string) {
  return content.split('\n').map((line, i) => {
    if (line.startsWith('### ')) return <h3 key={i} className="tc-h3">{line.slice(4)}</h3>;
    if (line.startsWith('## ')) return <h2 key={i} className="tc-h2">{line.slice(3)}</h2>;
    if (line.startsWith('**') && line.endsWith('**')) {
      return <p key={i} className="tc-bold">{line.slice(2, -2)}</p>;
    }
    if (/^\*\*(.+)\*\*:/.test(line)) {
      return <p key={i} className="tc-field" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />;
    }
    if (line.startsWith('- ')) return <li key={i} className="tc-li">{line.slice(2)}</li>;
    if (/^\d+\. /.test(line)) return <li key={i} className="tc-li tc-step">{line}</li>;
    if (line.trim() === '---') return <hr key={i} className="tc-divider" />;
    if (line.trim() === '') return <br key={i} />;
    return <p key={i} className="tc-p">{line}</p>;
  });
}

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const active = localStorage.getItem('activeChatId');
      if (active) {
        const store = localStorage.getItem('chatStore');
        if (store) return JSON.parse(store)[active] || [];
      }
    } catch (e) {}
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [template, setTemplate] = useState<TestTemplate>('Functional');
  const [copied, setCopied] = useState(false);
  // docMeta holds only file metadata; raw text lives server-side referenced by sessionDocId
  const [docMeta, setDocMeta] = useState<{
    name: string; sizeBytes: number; wordCount: number;
    pageCount?: number; detectedFormat: string;
    ocrApplied: boolean; truncated: boolean;
    warnings: string[]; sessionDocId: string;
  } | null>(null);

  const [conflictDoc, setConflictDoc] = useState<string | null>(null); // pending jiraId when conflict
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ─── Chat session management ────────────────────────────
  const [chatHistory, setChatHistory] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('chatHistory');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    return localStorage.getItem('activeChatId') || null;
  });
  const [chatStore, setChatStore] = useState<Record<string, Message[]>>(() => {
    try {
      const saved = localStorage.getItem('chatStore');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('appSettings');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  });

  useEffect(() => {
    (window as any).onSettingsUpdate = (newSettings: any) => {
      setSettings(newSettings);
    };
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
  }, [chatHistory]);

  useEffect(() => {
    localStorage.setItem('chatStore', JSON.stringify(chatStore));
  }, [chatStore]);

  useEffect(() => {
    if (activeChatId) localStorage.setItem('activeChatId', activeChatId);
    else localStorage.removeItem('activeChatId');
  }, [activeChatId]);

  // Constantly sync current messages into the chatStore for the active chat
  useEffect(() => {
    if (activeChatId) {
      setChatStore(prev => ({ ...prev, [activeChatId]: messages }));
    }
  }, [messages, activeChatId]);

  const generateId = () => `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const handleNewChat = useCallback(() => {
    // Save current chat if it has messages
    if (activeChatId && messages.length > 0) {
      setChatStore((prev) => ({ ...prev, [activeChatId]: messages }));
    }
    setMessages([]);
    setInput('');
    setActiveChatId(null);
  }, [activeChatId, messages]);

  const handleSelectChat = useCallback((id: string) => {
    // Save current chat first
    if (activeChatId && messages.length > 0) {
      setChatStore((prev) => ({ ...prev, [activeChatId]: messages }));
    }
    // Load selected chat
    const loaded = chatStore[id] || [];
    setMessages(loaded);
    setActiveChatId(id);
    setInput('');
  }, [activeChatId, messages, chatStore]);

  const handleDeleteChat = useCallback((id: string) => {
    setChatHistory((prev) => prev.filter((c) => c.id !== id));
    setChatStore((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (activeChatId === id) {
      setMessages([]);
      setActiveChatId(null);
    }
  }, [activeChatId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Core generate handler — accepts an optional override to resolve doc/jira conflict
  const handleGenerate = async (opts?: { forceJiraId?: string; forceDocOnly?: boolean; mergeBoth?: boolean }) => {
    const trimmed = input.trim();
    if ((!trimmed && !docMeta) || isLoading) return;

    const isJiraId = JIRA_ID_REGEX.test(trimmed.toUpperCase());

    // ── Conflict resolution: doc + Jira ID both present ──
    if (docMeta && isJiraId && !opts) {
      setConflictDoc(trimmed.toUpperCase());
      return; // pause — conflict modal will call back with resolution
    }

    let resolvedJiraId = isJiraId ? trimmed.toUpperCase() : undefined;
    let useDoc = !!docMeta;
    if (opts?.forceJiraId) { resolvedJiraId = opts.forceJiraId; useDoc = false; }
    if (opts?.forceDocOnly) { resolvedJiraId = undefined; useDoc = true; }
    if (opts?.mergeBoth) { resolvedJiraId = opts.forceJiraId; useDoc = true; }
    setConflictDoc(null);

    // ── New chat session ──
    let chatId = activeChatId;
    if (!chatId) {
      chatId = generateId();
      const titleText = trimmed || docMeta?.name || 'New Test Generation';
      const title = titleText.length > 40 ? titleText.slice(0, 40) + '…' : titleText;
      setActiveChatId(chatId);
      setChatHistory((prev) => {
        const updated = [{ id: chatId!, title, timestamp: Date.now() }, ...prev];
        if (updated.length > 10) {
          const toRemove = updated.slice(10).map(c => c.id);
          setChatStore(store => { const s = { ...store }; toRemove.forEach(id => delete s[id]); return s; });
        }
        return updated.slice(0, 10);
      });
    }

    let userDisplayContent = trimmed;
    if (docMeta && useDoc) userDisplayContent += userDisplayContent ? `\n📎 ${docMeta.name}` : `📎 ${docMeta.name}`;

    setMessages((prev) => [...prev, { role: 'user', content: userDisplayContent }]);
    setInput('');
    setIsLoading(true);

    try {
      let jiraTicket: JiraTicket | undefined;

      if (resolvedJiraId) {
        setLoadingStage('Fetching Jira ticket...');
        try {
          const result = await fetchJiraTicket(resolvedJiraId, settings);
          jiraTicket = result.ticket;
          setMessages((prev) => [...prev, { role: 'jira-ticket', content: '', jiraTicket }]);
        } catch (jiraError: any) {
          const errObj = jiraError.response?.data?.error || jiraError.response?.data;
          let errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || jiraError.message || 'Jira fetch failed');
          if (typeof errMsg !== 'string') errMsg = JSON.stringify(errMsg);
          setMessages((prev) => [...prev, { role: 'error', content: `⚠️ Jira fetch failed: ${errMsg}` }]);
          setIsLoading(false); setLoadingStage(''); return;
        }
      }

      setLoadingStage(`Generating ${template} test cases...`);
      const result = await generateTestCase(
        useDoc && !jiraTicket ? '' : trimmed,
        jiraTicket,
        settings,
        template,
        useDoc && docMeta ? docMeta.sessionDocId : undefined
      );

      const responseText = Array.isArray(result.response) ? 'Test cases generated successfully.' : (result.response || 'No response returned.');
      setMessages((prev) => {
        const updated = [...prev, { role: 'ai' as const, content: responseText, testCases: Array.isArray(result.response) ? result.response : undefined }];
        if (chatId) setChatStore((s) => ({ ...s, [chatId]: updated }));
        return updated;
      });
      if (useDoc) setDocMeta(null); // clear after successful generation
    } catch (error: any) {
      const errObj = error.response?.data?.detail || error.response?.data?.error || error.response?.data;
      let msg = typeof errObj === 'string' ? errObj : (errObj?.message || error.message || 'Generation failed');
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      setMessages((prev) => {
        const updated = [...prev, { role: 'error' as const, content: `Error: ${msg}` }];
        if (chatId) setChatStore((s) => ({ ...s, [chatId]: updated }));
        return updated;
      });
    } finally {
      setIsLoading(false); setLoadingStage('');
    }
  };

  // Copy all test cases from last AI message as TSV
  const handleCopyTSV = () => {
    const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases?.length);
    if (!aiMsgs.length) return;
    const tcs = aiMsgs[aiMsgs.length - 1].testCases!;
    const header = 'ID\tTitle\tType\tPriority\tPreconditions\tSteps\tTest Data\tExpected Result\tLinked Jira ID';
    const rows = tcs.map(tc => [tc.id, tc.title, tc.type, tc.priority, tc.preconditions,
      Array.isArray(tc.steps) ? tc.steps.join(' | ') : tc.steps,
      tc.test_data, tc.expected_result, tc.linked_jira_id].join('\t'));
    navigator.clipboard.writeText([header, ...rows].join('\n'));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };


  return (
    <div className="app-container">
      <Sidebar
        chatHistory={chatHistory}
        activeChatId={activeChatId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />
      <div className="main-content">
        {/* Header */}
        <div className="header">
          <div className="header-title">
            <div className="header-logo">TC</div>
            <div>
              <span className="header-name">Test Case Generator</span>
              <span className="header-sub">AI-powered · Jira integrated</span>
            </div>
          </div>
          <button className="btn-icon" onClick={() => setIsSettingsOpen(true)} title="Settings">
            <Settings size={20} />
          </button>
        </div>

        {/* Chat Area */}
        <div className="chat-area">
          {messages.length === 0 && !isLoading && (
            <div className="welcome-screen">
              <div className="welcome-icon">🧪</div>
              <h1 className="welcome-title">AI Test Case Generator</h1>
              <p className="welcome-desc">
                Enter a <strong>Jira ID</strong> (e.g. <code>PROJ-123</code>) to fetch the ticket and auto-generate test cases,
                or type any <strong>requirement</strong> directly.
              </p>
            </div>
          )}

          {messages.map((msg, index) => {
            if (msg.role === 'user') {
              return (
                <div key={index} className="message-row user-row">
                  <div className="message user-message">{msg.content}</div>
                </div>
              );
            }
            if (msg.role === 'jira-ticket' && msg.jiraTicket) {
              return (
                <div key={index} className="message-row ai-row">
                  <JiraTicketCard ticket={msg.jiraTicket} />
                </div>
              );
            }
            if (msg.role === 'error') {
              return (
                <div key={index} className="message-row ai-row">
                  <div className="message error-message">
                    <AlertCircle size={16} />
                    <span>{msg.content}</span>
                  </div>
                </div>
              );
            }
            if (msg.role === 'ai') {
              return (
                <div key={index} className="message-row ai-row">
                  <div className="message ai-message">
                    <div className="ai-label">
                      <span className="ai-dot" />
                      AI Response
                    </div>
                    <div className="tc-content">
                      {msg.testCases ? (
                        <div className="test-cases-table">
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                              <tr style={{ background: '#2d333b', color: '#c9d1d9', textAlign: 'left' }}>
                                <th style={{ padding: '8px', border: '1px solid #444c56' }}>ID</th>
                                <th style={{ padding: '8px', border: '1px solid #444c56' }}>Title</th>
                                <th style={{ padding: '8px', border: '1px solid #444c56' }}>Type</th>
                                <th style={{ padding: '8px', border: '1px solid #444c56' }}>Priority</th>
                                <th style={{ padding: '8px', border: '1px solid #444c56' }}>Steps</th>
                                <th style={{ padding: '8px', border: '1px solid #444c56' }}>Expected Result</th>
                              </tr>
                            </thead>
                            <tbody>
                              {msg.testCases.map((tc, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid #444c56' }}>
                                  <td style={{ padding: '8px', border: '1px solid #444c56' }}>{tc.id}</td>
                                  <td style={{ padding: '8px', border: '1px solid #444c56' }}>{tc.title}</td>
                                  <td style={{ padding: '8px', border: '1px solid #444c56' }}>{tc.type}</td>
                                  <td style={{ padding: '8px', border: '1px solid #444c56' }}>{tc.priority}</td>
                                  <td style={{ padding: '8px', border: '1px solid #444c56' }}>
                                    {Array.isArray(tc.steps) ? (
                                      <ol style={{ paddingLeft: '1.2rem', margin: '4px 0' }}>
                                        {tc.steps.map((step, sIdx) => (
                                          <li key={sIdx} style={{ marginBottom: '2px' }}>{step}</li>
                                        ))}
                                      </ol>
                                    ) : (
                                      <div style={{ whiteSpace: 'pre-wrap' }}>{tc.steps}</div>
                                    )}
                                  </td>
                                  <td style={{ padding: '8px', border: '1px solid #444c56' }}>
                                    {tc.expected_result}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        formatTestCases(msg.content)
                      )}
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })}

          {isLoading && (
            <div className="message-row ai-row">
              <div className="message loading-message">
                <Loader2 size={16} className="spin" />
                <span>{loadingStage || 'Processing...'}</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          {/* Conflict resolution prompt */}
          {conflictDoc && (
            <div style={{ padding: '10px 14px', background: '#2d1f00', border: '1px solid #e3b341', borderRadius: '8px', marginBottom: '8px', fontSize: '0.85rem', color: '#e3b341' }}>
              <p style={{ margin: '0 0 8px' }}>⚠️ Both a document and a Jira ID ({conflictDoc}) are provided. Which should be the primary requirement source?</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => handleGenerate({ forceDocOnly: true })} style={{ padding: '4px 12px', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', cursor: 'pointer', color: 'var(--text-1)' }}>Use Document</button>
                <button onClick={() => handleGenerate({ forceJiraId: conflictDoc })} style={{ padding: '4px 12px', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', cursor: 'pointer', color: 'var(--text-1)' }}>Use Jira ID</button>
                <button onClick={() => handleGenerate({ mergeBoth: true, forceJiraId: conflictDoc })} style={{ padding: '4px 12px', borderRadius: '4px', background: 'var(--accent-color)', border: 'none', cursor: 'pointer', color: '#fff' }}>Merge Both</button>
                <button onClick={() => setConflictDoc(null)} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: '4px', background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-3)' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="input-actions" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="file"
              id="doc-upload"
              style={{ display: 'none' }}
              accept=".pdf,.docx,.txt,.md,.csv,.html,.htm,.rtf"
              onChange={async (e) => {
                if (e.target.files && e.target.files[0]) {
                  try {
                    setIsLoading(true);
                    setLoadingStage('Parsing document...');
                    const res = await uploadDocument(e.target.files[0]);
                    setDocMeta({
                      name: res.originalname || e.target.files[0].name,
                      sizeBytes: res.sizeBytes || e.target.files[0].size,
                      wordCount: res.wordCount || 0,
                      pageCount: res.pageCount,
                      detectedFormat: res.detectedFormat || '',
                      ocrApplied: res.ocrApplied || false,
                      truncated: res.truncated || false,
                      warnings: res.warnings || [],
                      sessionDocId: res.sessionDocId,
                    });
                    e.target.value = '';
                  } catch (err: any) {
                    const errObj = err.response?.data?.detail || err.response?.data?.error || err.response?.data || err;
                    let msg = typeof errObj === 'string' ? errObj : JSON.stringify(errObj);
                    setMessages(prev => [...prev, { role: 'error', content: `📎 Upload failed: ${msg}` }]);
                  } finally {
                    setIsLoading(false); setLoadingStage('');
                  }
                }
              }}
            />
            <button
              className="btn-secondary"
              onClick={() => document.getElementById('doc-upload')?.click()}
              title="Import any requirement document to generate test cases"
              style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              <FileUp size={16} /> Import Doc
            </button>

            {/* Template selector */}
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as TestTemplate)}
              title="Test case template / coverage focus"
              style={{ padding: '0.45rem 0.6rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', color: 'var(--text-2)', fontSize: '0.82rem', cursor: 'pointer' }}
            >
              {TEMPLATES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Copy TSV */}
            <button
              className="btn-secondary"
              onClick={handleCopyTSV}
              title="Copy test cases as TSV (paste directly into Jira/Xray/TestRail)"
              style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: copied ? 'var(--green)' : 'var(--text-2)' }}
            >
              {copied ? <ClipboardCheck size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy TSV'}
            </button>

            <button
              className="btn-secondary"
              onClick={() => {
                const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases && m.testCases.length > 0);
                if (aiMsgs.length === 0) return alert('No test cases generated yet to export.');
                const tcs = aiMsgs[aiMsgs.length - 1].testCases!;
                const jiraId = tcs[0]?.linked_jira_id || 'custom';
                const ts = new Date().toISOString().split('T')[0];
                let md = `# Test Cases for ${jiraId}\n\n`;
                tcs.forEach(tc => {
                  md += `### ${tc.id}: ${tc.title}\n- **Type**: ${tc.type}\n- **Priority**: ${tc.priority}\n\n**Preconditions**: ${tc.preconditions}\n\n**Steps**:\n`;
                  const steps = Array.isArray(tc.steps) ? tc.steps : String(tc.steps).split('\n');
                  steps.forEach((s: string, i: number) => (md += `${i + 1}. ${s}\n`));
                  md += `\n**Test Data**: ${tc.test_data}\n\n**Expected Result**: ${tc.expected_result}\n\n---\n\n`;
                });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
                a.download = `${jiraId}_test_cases_${ts}.md`; a.click();
              }}
              title="Export Test Cases to Markdown"
              style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              <Download size={16} /> Export MD
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases && m.testCases.length > 0);
                if (aiMsgs.length === 0) return alert('No test cases generated yet to export.');
                const tcs = aiMsgs[aiMsgs.length - 1].testCases!;
                const jiraId = tcs[0]?.linked_jira_id || 'custom';
                const ts = new Date().toISOString().split('T')[0];
                const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
                let csv = 'ID,Title,Type,Priority,Preconditions,Steps,Test Data,Expected Result,Linked Jira ID\n';
                tcs.forEach(tc => {
                  csv += `${esc(tc.id)},${esc(tc.title)},${esc(tc.type)},${esc(tc.priority)},${esc(tc.preconditions)},${esc(Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps)},${esc(tc.test_data)},${esc(tc.expected_result)},${esc(tc.linked_jira_id)}\n`;
                });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                a.download = `${jiraId}_test_cases_${ts}.csv`; a.click();
              }}
              title="Export Test Cases to CSV"
              style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              <Download size={16} /> Export CSV
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases && m.testCases.length > 0);
                if (aiMsgs.length === 0) return alert('No test cases generated yet to export.');
                const tcs = aiMsgs[aiMsgs.length - 1].testCases!;
                const jiraId = tcs[0]?.linked_jira_id || 'custom';
                const ws = XLSX.utils.json_to_sheet(tcs.map(tc => ({
                  'Test Case ID': tc.id, 'Title': tc.title, 'Type': tc.type, 'Priority': tc.priority,
                  'Preconditions': tc.preconditions,
                  'Test Steps': Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps,
                  'Test Data': tc.test_data, 'Expected Result': tc.expected_result, 'Linked Jira ID': tc.linked_jira_id,
                })));
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, jiraId.slice(0, 31));
                XLSX.writeFile(wb, `${jiraId}_test_cases_${new Date().toISOString().split('T')[0]}.xlsx`);
              }}
              title="Export Test Cases to Excel"
              style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--green-dim)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: 'var(--green)' }}
            >
              <Download size={16} /> Export Excel
            </button>
          </div>

          <div className="input-wrapper" style={{ flexDirection: 'column' }}>
            {/* Doc chip */}
            {docMeta && (
              <div style={{ padding: '8px 12px', background: 'var(--bg-3)', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1rem' }}>{docMeta.ocrApplied ? '🖼️' : '📄'}</span>
                  <span style={{ fontWeight: '500', color: 'var(--text-1)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={docMeta.name}>{docMeta.name}</span>
                  <span style={{ color: 'var(--text-3)' }}>{(docMeta.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                  {docMeta.pageCount && <span style={{ color: 'var(--text-3)' }}>{docMeta.pageCount} pg</span>}
                  <button onClick={() => setDocMeta(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ marginTop: '4px', color: docMeta.ocrApplied ? '#e3b341' : 'var(--green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {docMeta.ocrApplied ? '⚠️ OCR applied' : '✅ Parsed'}
                  · {docMeta.wordCount.toLocaleString()} words · {docMeta.detectedFormat}
                  {docMeta.truncated && <span style={{ color: '#e3b341' }}>· ⚠️ Truncated</span>}
                  <span style={{ color: 'var(--text-3)', marginLeft: '4px' }}>📎 Requirement source: document</span>
                </div>
                {docMeta.warnings.map((w, i) => (
                  <div key={i} style={{ marginTop: '2px', color: '#e3b341', fontSize: '0.78rem' }}>⚠️ {w}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', width: '100%', position: 'relative' }}>
              <input
                id="main-input"
                type="text"
                placeholder={docMeta ? 'Optionally add a Jira ID or extra context...' : 'Enter Jira ID (e.g. PROJ-123) or describe a requirement...'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                disabled={isLoading}
                autoComplete="off"
              />
              <div className="input-hint">
                {JIRA_ID_REGEX.test(input.trim().toUpperCase()) ? (
                  <><ExternalLink size={12} /> Will fetch Jira ticket</>
                ) : docMeta ? (
                  <><CheckCircle2 size={12} /> Document ready</>
                ) : null}
              </div>
            </div>
          </div>
          <button
            id="generate-btn"
            className="btn-primary"
            onClick={() => handleGenerate()}
            disabled={isLoading || (!input.trim() && !docMeta)}
          >
            {isLoading ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </div>
  );
}

export default App;

