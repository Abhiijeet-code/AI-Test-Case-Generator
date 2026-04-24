import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Send, ExternalLink, AlertCircle, CheckCircle2, Loader2, Tag, ChevronDown, ChevronUp, FileUp, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import Sidebar from './components/Sidebar';
import type { ChatSession } from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import { generateTestCase, fetchJiraTicket, uploadDocument } from './api';

// Jira ID pattern: PROJECT-123
const JIRA_ID_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

interface JiraTicket {
  jiraId: string;
  summary: string;
  description: string;
  priority?: string;
  status?: string;
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
          {ticket.priority && (
            <span className="badge" style={{ color, borderColor: color, backgroundColor: `${color}18` }}>
              {ticket.priority}
            </span>
          )}
          {ticket.status && (
            <span className="badge status-badge">{ticket.status}</span>
          )}
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
  const [attachedFile, setAttachedFile] = useState<{ name: string; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
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

  const handleGenerate = async () => {
    const trimmed = input.trim();
    if ((!trimmed && !attachedFile) || isLoading) return;

    // Determine the requirement text to send to AI
    let requirementText = trimmed;
    if (attachedFile) {
      if (trimmed) {
        requirementText = `${trimmed}\n\n[Attached Document: ${attachedFile.name}]\n${attachedFile.text}`;
      } else {
        requirementText = `[Attached Document: ${attachedFile.name}]\n${attachedFile.text}`;
      }
    }

    // Create a new chat session if none is active
    let chatId = activeChatId;
    if (!chatId) {
      chatId = generateId();
      const titleText = trimmed || attachedFile?.name || 'New Test Generation';
      const title = titleText.length > 40 ? titleText.slice(0, 40) + '…' : titleText;
      setActiveChatId(chatId);
      setChatHistory((prev) => {
        const updated = [{ id: chatId!, title, timestamp: Date.now() }, ...prev];
        if (updated.length > 10) {
          // Keep only 10 chats
          const toRemove = updated.slice(10).map(c => c.id);
          setChatStore(store => {
            const nextStore = { ...store };
            toRemove.forEach(id => delete nextStore[id]);
            return nextStore;
          });
        }
        return updated.slice(0, 10);
      });
    }

    // Build the user message for UI display
    let userDisplayContent = trimmed;
    if (attachedFile) {
      userDisplayContent += userDisplayContent ? `\n(Attached: ${attachedFile.name})` : `(Attached: ${attachedFile.name})`;
    }

    setMessages((prev) => [...prev, { role: 'user', content: userDisplayContent }]);
    setInput('');
    setAttachedFile(null); // Clear attachment after use
    setIsLoading(true);

    const isJiraId = JIRA_ID_REGEX.test(trimmed.toUpperCase());

    try {
      let jiraTicket: JiraTicket | undefined;

      if (isJiraId) {
        setLoadingStage('Fetching Jira ticket...');
        const jiraId = trimmed.toUpperCase();
        try {
          const result = await fetchJiraTicket(jiraId, settings);
          jiraTicket = result.ticket;
          setMessages((prev) => [...prev, { role: 'jira-ticket', content: '', jiraTicket }]);
        } catch (jiraError: any) {
          const errObj = jiraError.response?.data?.error || jiraError.response?.data;
          let errMsg = typeof errObj === 'string' ? errObj : (errObj?.message || jiraError.message || 'Jira fetch failed');
          if (typeof errMsg !== 'string') errMsg = JSON.stringify(errMsg);
          setMessages((prev) => [
            ...prev,
            { role: 'error', content: `⚠️ Jira fetch failed: ${errMsg}` },
          ]);
          setIsLoading(false);
          setLoadingStage('');
          return;
        }
      }

      setLoadingStage('Generating test cases...');
      const result = await generateTestCase(requirementText, jiraTicket, settings);
      
      const responseText = Array.isArray(result.response) 
        ? "Test cases generated successfully." 
        : (result.response || 'No response returned.');

      setMessages((prev) => {
        const updated = [...prev, { 
          role: 'ai' as const, 
          content: responseText, 
          testCases: Array.isArray(result.response) ? result.response : undefined 
        }];
        if (chatId) setChatStore((s) => ({ ...s, [chatId]: updated }));
        return updated;
      });
    } catch (error: any) {
      const errObj = error.response?.data?.error || error.response?.data;
      let msg = typeof errObj === 'string' ? errObj : (errObj?.message || error.message || 'Generation failed');
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      setMessages((prev) => {
        const updated = [...prev, { role: 'error' as const, content: `Error: ${msg}` }];
        if (chatId) setChatStore((s) => ({ ...s, [chatId]: updated }));
        return updated;
      });
    } finally {
      setIsLoading(false);
      setLoadingStage('');
    }
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
          <div className="input-actions" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input 
              type="file" 
              id="doc-upload" 
              style={{ display: 'none' }} 
              accept=".pdf,.docx,.txt,.md"
              onChange={async (e) => {
                if (e.target.files && e.target.files[0]) {
                  try {
                    setIsLoading(true);
                    setLoadingStage('Parsing document...');
                    const res = await uploadDocument(e.target.files[0]);
                    setAttachedFile({ name: res.originalname || e.target.files[0].name, text: res.text });
                    e.target.value = ''; // Request success, clear file
                  } catch (err) {
                    setMessages(prev => [...prev, { role: 'error', content: 'Failed to upload document.' }]);
                  } finally {
                    setIsLoading(false);
                  }
                }
              }}
            />
            <button 
              className="btn-secondary" 
              onClick={() => document.getElementById('doc-upload')?.click()}
              title="Upload Document (.pdf, .docx, .txt)"
              style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              <FileUp size={16} /> Import Doc
            </button>
            <button 
              className="btn-secondary" 
              onClick={() => {
                const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases && m.testCases.length > 0);
                if (aiMsgs.length === 0) return alert('No test cases generated yet to export.');
                const latestCases = aiMsgs[aiMsgs.length - 1].testCases!;
                const jiraId = latestCases[0]?.linked_jira_id || 'custom';
                const timestamp = new Date().toISOString().split('T')[0];
                // Generate markdown client-side
                let md = `# Test Cases for ${jiraId}\n\n`;
                latestCases.forEach((tc) => {
                  md += `### ${tc.id}: ${tc.title}\n`;
                  md += `- **Type**: ${tc.type}\n- **Priority**: ${tc.priority}\n`;
                  md += `\n**Preconditions**: ${tc.preconditions}\n\n**Steps**:\n`;
                  const steps = Array.isArray(tc.steps) ? tc.steps : String(tc.steps).split('\n');
                  steps.forEach((s: string, i: number) => (md += `${i + 1}. ${s}\n`));
                  md += `\n**Expected Result**: ${tc.expected_result}\n\n---\n\n`;
                });
                const url = window.URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `${jiraId}_test_cases_${timestamp}.md`;
                a.click();
                window.URL.revokeObjectURL(url);
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
                const latestCases = aiMsgs[aiMsgs.length - 1].testCases!;
                const jiraId = latestCases[0]?.linked_jira_id || 'custom';
                const timestamp = new Date().toISOString().split('T')[0];
                // Generate CSV client-side
                const escape = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
                let csv = 'ID,Title,Type,Priority,Preconditions,Steps,Test Data,Expected Result\n';
                latestCases.forEach((tc) => {
                  const steps = escape(Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps);
                  csv += `${escape(tc.id)},${escape(tc.title)},${escape(tc.type)},${escape(tc.priority)},${escape(tc.preconditions)},${steps},${escape(tc.test_data)},${escape(tc.expected_result)}\n`;
                });
                const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `${jiraId}_test_cases_${timestamp}.csv`;
                a.click();
                window.URL.revokeObjectURL(url);
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
                const latestCases = aiMsgs[aiMsgs.length - 1].testCases!;
                
                // Export to Excel using xlsx
                const worksheet = XLSX.utils.json_to_sheet(latestCases.map(tc => ({
                  'Test Case ID': tc.id,
                  'Title': tc.title,
                  'Type': tc.type,
                  'Priority': tc.priority,
                  'Preconditions': tc.preconditions,
                  'Test Steps': Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps,
                  'Test Data': tc.test_data,
                  'Expected Result': tc.expected_result,
                  'Linked Jira ID': tc.linked_jira_id,
                })));
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Test Cases");
                XLSX.writeFile(workbook, `TestCases_${new Date().toISOString().split('T')[0]}.xlsx`);
              }}
              title="Export Test Cases to Excel"
              style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--green-dim)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: 'var(--green)' }}
            >
              <Download size={16} /> Export Excel
            </button>
          </div>
          <div className="input-wrapper" style={{ flexDirection: 'column' }}>
            {attachedFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--bg-3)', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <Tag size={14} color="var(--blue)" />
                <span style={{ fontWeight: '500', color: 'var(--text-1)' }}>{attachedFile.name}</span>
                <span style={{ color: 'var(--text-3)', fontSize: '0.75rem', marginLeft: '4px' }}>
                  ({Math.round(attachedFile.text.length / 1024)} KB)
                </span>
                
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                  <button onClick={() => setShowPreview(!showPreview)} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-2)' }}>
                    {showPreview ? 'Hide Preview' : 'Preview'}
                  </button>
                  <button onClick={() => document.getElementById('doc-upload')?.click()} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-2)' }}>
                    Replace
                  </button>
                  <button onClick={() => { setAttachedFile(null); setShowPreview(false); }} style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', color: 'var(--red)' }}>
                    Remove
                  </button>
                </div>
              </div>
            )}
            
            {showPreview && attachedFile && (
              <div style={{ padding: '12px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', maxHeight: '200px', overflowY: 'auto', fontSize: '0.8rem', color: 'var(--text-2)', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {attachedFile.text.substring(0, 1500)}
                {attachedFile.text.length > 1500 && '... [Preview truncated]'}
              </div>
            )}
            
            <div style={{ display: 'flex', width: '100%', position: 'relative' }}>
              <input
              id="main-input"
              type="text"
              placeholder="Enter Jira ID (e.g. PROJ-123) or describe a requirement..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              disabled={isLoading}
              autoComplete="off"
            />
            <div className="input-hint">
              {JIRA_ID_REGEX.test(input.trim().toUpperCase()) ? (
                <><ExternalLink size={12} /> Will fetch Jira ticket</>
              ) : attachedFile ? (
                <><CheckCircle2 size={12} /> Document attached</>
              ) : null}
            </div>
            </div>
          </div>
          <button
            id="generate-btn"
            className="btn-primary"
            onClick={handleGenerate}
            disabled={isLoading || (!input.trim() && !attachedFile)}
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
