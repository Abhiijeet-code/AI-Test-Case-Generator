import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Settings, 
  ExternalLink, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Tag, 
  ChevronDown, 
  ChevronUp, 
  FileUp, 
  Download, 
  Copy, 
  ClipboardCheck,
  BookOpen,
  Zap,
  Code2,
  Plus,
  ArrowRight,
  FileSpreadsheet,
  X,
  Terminal,
  FileCode,
  PanelLeft,
  Coffee,
  Sparkles,
  Check,
  Folder
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Sidebar, { DEMO_SESSIONS } from './components/Sidebar';
import type { ChatSession } from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import RagWorkflowModal from './components/RagWorkflowModal';
import { 
  generateTestCase, 
  fetchJiraTicket, 
  uploadDocument, 
  exportVsCodeApi, 
  openFolderApi,
  chatWithAssistant,
  generateFrameworkApi,
  getScaffoldBundle,
  launchEclipseApi,
  getSettings
} from './api';

type TestTemplate = 'No Selection (QA Query / Chat)' | 'Functional & E2E' | 'Code Generation Only' | 'Boundary & Edge' | 'BDD Gherkin Matrix' | 'Security Boundary Matrix' | 'Smoke Test';
const TEMPLATES: TestTemplate[] = [
  'No Selection (QA Query / Chat)',
  'Functional & E2E',
  'Code Generation Only',
  'Boundary & Edge',
  'BDD Gherkin Matrix',
  'Security Boundary Matrix',
  'Smoke Test'
];

// Jira ID pattern: PROJECT-123
const JIRA_ID_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

const SAMPLE_SCENARIOS: Array<{
  title: string;
  desc: string;
  prompt: string;
  framework: 'playwright' | 'selenium' | 'none';
  language: string;
  template: TestTemplate;
}> = [
  {
    title: 'Amazon Sign-In Flow',
    desc: 'Selenium Python POM for email, OTP & password boundary checks',
    prompt: 'Amazon Sign-In: Verify email validation, 2FA OTP prompt, and password boundary conditions',
    framework: 'selenium',
    language: 'python',
    template: 'Boundary & Edge'
  },
  {
    title: 'Stripe Webhook Idempotency',
    desc: 'Playwright TypeScript test suite for payment deduplication',
    prompt: 'Stripe Webhook Idempotency: Validate payment_intent.succeeded event deduplication, retry exponential backoff, and duplicate X-Idempotency-Key headers',
    framework: 'playwright',
    language: 'typescript',
    template: 'Functional & E2E'
  },
  {
    title: 'Healthcare Patient Portal Auth',
    desc: 'Security & BDD HIPAA audit trail and session timeout flow',
    prompt: 'Healthcare Patient Portal: Multi-tenant RBAC session timeout, HIPAA audit trail logging, and encrypted JWT token revocation on logout',
    framework: 'none',
    language: 'typescript',
    template: 'Security Boundary Matrix'
  },
  {
    title: 'E-Commerce Cart & Discount',
    desc: 'Playwright Java Page Object Model for order validation',
    prompt: 'E-Commerce Checkout: Verify discount coupon validation, inventory reservation race conditions, and order confirmation email event',
    framework: 'playwright',
    language: 'java',
    template: 'Functional & E2E'
  },
  {
    title: 'Banking Balance Transfer API',
    desc: 'Selenium Java TestNG high-concurrency boundary checks',
    prompt: 'Core Banking API: High-concurrency peer-to-peer balance transfer boundary checks, overdraft limit enforcement, and rollback on network drop',
    framework: 'selenium',
    language: 'java',
    template: 'Boundary & Edge'
  }
];

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

export interface CodeBundle {
  framework: string;
  language: string;
  jiraId: string;
  fileName: string;
  filePath?: string;
  specCode: string;
  pageFileName?: string;
  pageCode?: string;
  configCode?: string;
  runCommand: string;
  vscodeUri: string;
  instructions: string[];
}

interface Message {
  role: 'user' | 'ai' | 'jira-ticket' | 'error';
  content: string;
  jiraTicket?: JiraTicket;
  testCases?: TestCase[];
  codeBundle?: CodeBundle;
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
        <span>Ticket fetched — generating test cases & automation specs...</span>
      </div>
    </div>
  );
}

function CodeAutomationCard({ 
  bundle, 
  onSwitchLanguage,
  onOpenEclipse,
  onOpenVsCode
}: { 
  bundle: CodeBundle; 
  onSwitchLanguage?: (fw: string, lang: string) => void;
  onOpenEclipse?: (bundle: CodeBundle) => void;
  onOpenVsCode?: (bundle: CodeBundle) => void;
}) {
  const [activeTab, setActiveTab] = useState<'spec' | 'pom' | 'config'>('spec');
  const [copied, setCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  const currentCode = activeTab === 'spec' 
    ? bundle.specCode 
    : activeTab === 'pom' 
    ? (bundle.pageCode || bundle.specCode) 
    : (bundle.configCode || bundle.specCode);

  const currentFileName = activeTab === 'spec'
    ? bundle.fileName
    : activeTab === 'pom'
    ? (bundle.pageFileName || 'PageObject.ts')
    : 'playwright.config.ts';

  const handleCopyCode = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([currentCode], { type: 'text/plain' }));
    a.download = currentFileName;
    a.click();
  };

  const handleDefaultOpenVsCode = () => {
    if (onOpenVsCode) {
      onOpenVsCode(bundle);
    } else if (bundle.vscodeUri) {
      window.location.href = bundle.vscodeUri;
    }
  };

  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden', margin: '10px 0' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', background: '#161b22', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ 
            background: bundle.framework === 'playwright' ? '#007acc' : bundle.framework === 'selenium' ? '#43a047' : '#00b4d8', 
            color: '#fff', 
            padding: '2px 8px', 
            borderRadius: 4, 
            fontSize: 11, 
            fontWeight: 700 
          }}>
            {bundle.framework.toUpperCase()}
          </span>

          {bundle.framework === 'playwright' && onSwitchLanguage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#090d16', padding: '2px 4px', borderRadius: 5, border: '1px solid #30363d' }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, marginRight: 2 }}>Language:</span>
              {[
                { id: 'typescript', label: 'TS' },
                { id: 'javascript', label: 'JS' },
                { id: 'python', label: 'Py' },
                { id: 'java', label: 'Java' },
                { id: 'csharp', label: 'C#' },
              ].map((l) => (
                <button
                  key={l.id}
                  onClick={() => onSwitchLanguage('playwright', l.id)}
                  style={{
                    padding: '1px 6px',
                    borderRadius: 3,
                    fontSize: 10,
                    fontWeight: 700,
                    background: bundle.language === l.id ? '#007acc' : 'transparent',
                    color: bundle.language === l.id ? '#fff' : 'var(--text-3)',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  title={`Switch to Playwright in ${l.label}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}

          {bundle.framework === 'selenium' && onSwitchLanguage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#090d16', padding: '2px 4px', borderRadius: 5, border: '1px solid #30363d' }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, marginRight: 2 }}>Language:</span>
              {[
                { id: 'java', label: 'Java' },
                { id: 'python', label: 'Py' },
                { id: 'csharp', label: 'C#' },
                { id: 'javascript', label: 'JS' },
                { id: 'ruby', label: 'Ruby' },
              ].map((l) => (
                <button
                  key={l.id}
                  onClick={() => onSwitchLanguage('selenium', l.id)}
                  style={{
                    padding: '1px 6px',
                    borderRadius: 3,
                    fontSize: 10,
                    fontWeight: 700,
                    background: bundle.language === l.id ? '#43a047' : 'transparent',
                    color: bundle.language === l.id ? '#fff' : 'var(--text-3)',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  title={`Switch to Selenium in ${l.label}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}

          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#e6edf3' }}>
            {currentFileName}
          </span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={handleCopyCode}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#21262d', border: '1px solid #30363d', borderRadius: 4, color: copied ? '#3fb950' : '#c9d1d9', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            title="Copy script"
          >
            {copied ? <ClipboardCheck size={12} /> : <Copy size={12} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          <button
            onClick={handleDownload}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#21262d', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            title="Download test file"
          >
            <Download size={12} />
            <span>Download</span>
          </button>

          {bundle.framework === 'selenium' ? (
            <button
              onClick={() => onOpenEclipse ? onOpenEclipse(bundle) : alert('Opening Eclipse')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', background: 'linear-gradient(135deg, #4c1d95, #6d28d9)', border: '1px solid #8b5cf6', borderRadius: 4, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              title="Open Selenium test project strictly in Eclipse IDE"
            >
              <Coffee size={12} color="#fcd34d" />
              <span>Open in Eclipse</span>
            </button>
          ) : (
            <button
              onClick={handleDefaultOpenVsCode}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', background: '#007acc', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              title="Launch and edit directly in VS Code"
            >
              <ExternalLink size={12} />
              <span>Open in VS Code</span>
            </button>
          )}
        </div>
      </div>

      {/* Code Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '6px 12px', background: '#090d16', borderBottom: '1px solid #21262d' }}>
        <button
          onClick={() => setActiveTab('spec')}
          style={{ padding: '3px 10px', borderRadius: 4, background: activeTab === 'spec' ? '#21262d' : 'transparent', border: 'none', color: activeTab === 'spec' ? '#fff' : '#8b949e', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          📄 Test Spec
        </button>
        {bundle.pageCode && (
          <button
            onClick={() => setActiveTab('pom')}
            style={{ padding: '3px 10px', borderRadius: 4, background: activeTab === 'pom' ? '#21262d' : 'transparent', border: 'none', color: activeTab === 'pom' ? '#fff' : '#8b949e', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            🏗️ Page Object Model
          </button>
        )}
        {bundle.configCode && (
          <button
            onClick={() => setActiveTab('config')}
            style={{ padding: '3px 10px', borderRadius: 4, background: activeTab === 'config' ? '#21262d' : 'transparent', border: 'none', color: activeTab === 'config' ? '#fff' : '#8b949e', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            ⚙️ Configuration
          </button>
        )}
      </div>

      {/* Code Box */}
      <pre style={{ margin: 0, padding: 14, background: '#070a0f', color: '#93c5fd', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.5, maxHeight: 320, overflowY: 'auto' }}>
        {currentCode}
      </pre>

      {/* Execution Terminal Command Pill */}
      {bundle.runCommand && (
        <div style={{ padding: '8px 12px', background: '#111827', borderTop: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b949e' }}>
            <Terminal size={13} color="#38bdf8" />
            <span>Run:</span>
            <code style={{ background: '#1f2937', color: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }}>
              {bundle.runCommand}
            </code>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(bundle.runCommand);
              setCmdCopied(true);
              setTimeout(() => setCmdCopied(false), 2000);
            }}
            style={{ background: 'transparent', border: 'none', color: cmdCopied ? '#3fb950' : '#8b949e', fontSize: 11, cursor: 'pointer' }}
          >
            {cmdCopied ? '✓ Copied' : 'Copy command'}
          </button>
        </div>
      )}
    </div>
  );
}

function formatTestCases(content: string) {
  const parts: React.ReactNode[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLang = '';

  lines.forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        parts.push(
          <div key={`code-${i}`} className="tc-code-block-wrapper">
            {codeLang && <div className="tc-code-lang">{codeLang}</div>}
            <pre className="tc-code-pre">
              <code>{codeBlockLines.join('\n')}</code>
            </pre>
          </div>
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    if (line.startsWith('### ')) {
      parts.push(<h3 key={i} className="tc-h3">{line.slice(4)}</h3>);
      return;
    }
    if (line.startsWith('## ')) {
      parts.push(<h2 key={i} className="tc-h2">{line.slice(3)}</h2>);
      return;
    }
    if (line.startsWith('# ')) {
      parts.push(<h1 key={i} className="tc-h1" style={{ fontSize: '1.25rem', color: '#58a6ff', marginBottom: '8px' }}>{line.slice(2)}</h1>);
      return;
    }
    if (line.startsWith('**') && line.endsWith('**')) {
      parts.push(<p key={i} className="tc-bold">{line.slice(2, -2)}</p>);
      return;
    }
    if (/^\*\*(.+)\*\*:/.test(line)) {
      parts.push(<p key={i} className="tc-field" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />);
      return;
    }
    if (line.startsWith('- ')) {
      parts.push(
        <li key={i} className="tc-li" dangerouslySetInnerHTML={{ 
          __html: line.slice(2)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code class="tc-inline-code">$1</code>')
        }} />
      );
      return;
    }
    if (/^\d+\. /.test(line)) {
      parts.push(
        <li key={i} className="tc-li tc-step" dangerouslySetInnerHTML={{ 
          __html: line
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code class="tc-inline-code">$1</code>')
        }} />
      );
      return;
    }
    if (line.trim() === '---') {
      parts.push(<hr key={i} className="tc-divider" />);
      return;
    }
    if (line.trim() === '') {
      parts.push(<br key={i} />);
      return;
    }
    parts.push(
      <p key={i} className="tc-p" dangerouslySetInnerHTML={{ 
        __html: line
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`([^`]+)`/g, '<code class="tc-inline-code">$1</code>')
      }} />
    );
  });

  if (inCodeBlock && codeBlockLines.length > 0) {
    parts.push(
      <div key="code-tail" className="tc-code-block-wrapper">
        <pre className="tc-code-pre">
          <code>{codeBlockLines.join('\n')}</code>
        </pre>
      </div>
    );
  }

  return parts;
}

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [playwrightLang, setPlaywrightLang] = useState<string>('typescript');
  const [isRagModalOpen, setIsRagModalOpen] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [codeModalData, setCodeModalData] = useState<{
    title: string;
    fileName: string;
    filePath?: string;
    specCode: string;
    configCode?: string;
    instructions: string[];
    vscodeUri?: string;
    language?: string;
    suiteCases?: TestCase[];
    suiteName?: string;
    jiraId?: string;
  } | null>(null);

  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);
  const [selectedFramework, setSelectedFramework] = useState<'playwright' | 'selenium' | 'none'>('none');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('typescript');
  const [isFrameworkEnabled, setIsFrameworkEnabled] = useState<boolean>(false);
  const [showTestCaseOnlyPopup, setShowTestCaseOnlyPopup] = useState<boolean>(false);
  const [testCaseOnlyPopupMsg, setTestCaseOnlyPopupMsg] = useState<string>('Test Case Only');
  const [eclipseModalData, setEclipseModalData] = useState<{
    status: string;
    fileName: string;
    filePath: string;
    workspacePath: string;
    instructions: string[];
    code?: string;
    pageCode?: string;
    configCode?: string;
  } | null>(null);
  const [vsCodeModalData, setVsCodeModalData] = useState<{
    status: string;
    fileName: string;
    filePath: string;
    workspacePath: string;
    vscodeUri?: string;
    instructions: string[];
    specCode?: string;
    pageCode?: string;
    pageFileName?: string;
    configCode?: string;
  } | null>(null);

  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isFrameworkDropdownOpen, setIsFrameworkDropdownOpen] = useState(false);
  const [sampleIndex, setSampleIndex] = useState(0);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const frameworkMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setIsAttachMenuOpen(false);
      }
      if (frameworkMenuRef.current && !frameworkMenuRef.current.contains(e.target as Node)) {
        setIsFrameworkDropdownOpen(false);
      }
    };
    if (isAttachMenuOpen || isFrameworkDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isAttachMenuOpen, isFrameworkDropdownOpen]);

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
  const [template, setTemplate] = useState<TestTemplate>('No Selection (QA Query / Chat)');
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Auto-resize textarea dynamically based on scrollHeight
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 26), 200)}px`;
    }
  }, [input]);

  // When 'Code Generation Only' is selected, 'none' (Test Cases Only) cannot be selected or active
  useEffect(() => {
    if (template === 'Code Generation Only' && selectedFramework === 'none') {
      setSelectedFramework('playwright');
      if (!selectedLanguage) setSelectedLanguage('typescript');
    }
  }, [template, selectedFramework, selectedLanguage]);
  
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
      if (localStorage.getItem('chatHistory_cleared') === 'true') {
        return [];
      }
      const saved = localStorage.getItem('chatHistory');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEMO_SESSIONS;
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

    getSettings().then((backendSettings) => {
      if (backendSettings && typeof backendSettings === 'object' && !Array.isArray(backendSettings)) {
        setSettings((prev: any) => {
          if (!prev) return backendSettings;
          return { ...backendSettings, ...prev };
        });
      }
    }).catch(() => {});
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
    if (activeChatId && messages.length > 0) {
      setChatStore((prev) => ({ ...prev, [activeChatId]: messages }));
    }
    setMessages([]);
    setInput('');
    setActiveChatId(null);
  }, [activeChatId, messages]);

  const handleSelectChat = useCallback((id: string) => {
    if (activeChatId && messages.length > 0) {
      setChatStore((prev) => ({ ...prev, [activeChatId]: messages }));
    }
    const loaded = chatStore[id] || [];
    setMessages(loaded);
    setActiveChatId(id);
    setInput('');
  }, [activeChatId, messages, chatStore]);

  const handleDeleteChat = useCallback((id: string) => {
    setChatHistory((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        try {
          localStorage.setItem('chatHistory_cleared', 'true');
        } catch (e) {}
      }
      return next;
    });
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

  const handleClearAllChats = useCallback(() => {
    setChatHistory([]);
    setChatStore({});
    setMessages([]);
    setActiveChatId(null);
    try {
      localStorage.setItem('chatHistory', '[]');
      localStorage.setItem('chatHistory_cleared', 'true');
      localStorage.setItem('chatStore', '{}');
      localStorage.removeItem('activeChatId');
    } catch (e) {}
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Core generate handler
  const handleGenerate = async (opts?: { forceJiraId?: string; forceDocOnly?: boolean; mergeBoth?: boolean; customPrompt?: string }) => {
    const rawInput = opts?.customPrompt !== undefined ? opts.customPrompt : input;
    const trimmed = rawInput.trim();
    if ((!trimmed && !docMeta) || isLoading) return;

    const isJiraId = JIRA_ID_REGEX.test(trimmed.toUpperCase());

    // Conflict resolution
    if (docMeta && isJiraId && !opts) {
      setConflictDoc(trimmed.toUpperCase());
      return;
    }

    let resolvedJiraId = isJiraId ? trimmed.toUpperCase() : undefined;
    let useDoc = !!docMeta;
    if (opts?.forceJiraId) { resolvedJiraId = opts.forceJiraId; useDoc = false; }
    if (opts?.forceDocOnly) { resolvedJiraId = undefined; useDoc = true; }
    if (opts?.mergeBoth) { resolvedJiraId = opts.forceJiraId; useDoc = true; }
    setConflictDoc(null);

    // New chat session
    let chatId = activeChatId;
    if (!chatId) {
      chatId = generateId();
      const titleText = trimmed || docMeta?.name || 'New Test Generation';
      const title = titleText.length > 36 ? titleText.slice(0, 36) + '…' : titleText;
      setActiveChatId(chatId);
      try {
        localStorage.removeItem('chatHistory_cleared');
      } catch (e) {}
      setChatHistory((prev) => {
        const updated = [{ 
          id: chatId!, 
          title, 
          tag: resolvedJiraId ? `#${resolvedJiraId}` : '#REQ',
          badge: template.includes('E2E') ? 'E2E' : template.includes('BDD') ? 'BDD' : 'REST',
          badgeColor: '#388bfd',
          timestamp: Date.now() 
        }, ...prev];
        return updated.slice(0, 15);
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
        setLoadingStage('Fetching Jira ticket context & PRD...');
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

      // Check if user is asking for code explanation / QA question vs code framework vs test cases
      const trimmedLower = trimmed.toLowerCase();
      const isExplanationOrQuery = /explain|samjhao|what\s+is|what\s+does|how\s+to|how\s+does|review|analyze|debug|why|error|clarify|walkthrough|break\s*down|difference\s+between|kya\s+hai|kaise/i.test(trimmedLower);
      const explicitlyWantsCode = /generate\s*code|write\s*code|create\s*code|build\s*code|bana\s*code|make\s*script|codegen|new\s*framework|generate\s*selenium|generate\s*playwright/i.test(trimmedLower);
      const explicitlyWantsTestCases = /test\s*cases?|testcases?|scenarios?|test\s*suite\s*cases|qa\s*cases/i.test(trimmedLower) && !explicitlyWantsCode;

      let executionMode: 'qa_query' | 'code_generation' | 'test_cases' = 'qa_query';

      if (template === 'No Selection (QA Query / Chat)') {
        if (explicitlyWantsCode) executionMode = 'code_generation';
        else if (explicitlyWantsTestCases) executionMode = 'test_cases';
        else executionMode = 'qa_query';
      } else if (template === 'Code Generation Only') {
        executionMode = (isExplanationOrQuery && !explicitlyWantsCode) ? 'qa_query' : 'code_generation';
      } else {
        // Any test cases template (Functional & E2E, Boundary & Edge, etc.)
        if (isExplanationOrQuery && !explicitlyWantsCode && !explicitlyWantsTestCases) {
          executionMode = 'qa_query';
        } else if (selectedFramework !== 'none' && !explicitlyWantsTestCases) {
          executionMode = 'code_generation';
        } else {
          executionMode = 'test_cases';
        }
      }

      if (executionMode === 'qa_query') {
        setLoadingStage('Analyzing QA query & synthesizing response...');
        const chatRes = await chatWithAssistant(
          trimmed,
          jiraTicket,
          settings,
          template,
          useDoc && docMeta ? docMeta.sessionDocId : undefined,
          'none',
          selectedLanguage,
          false
        );

        setMessages((prev) => {
          const updated = [...prev, {
            role: 'ai' as const,
            content: chatRes.reply || 'Here is the response to your QA query.',
            codeBundle: undefined,
            testCases: undefined
          }];
          if (chatId) setChatStore((s) => ({ ...s, [chatId]: updated }));
          return updated;
        });

      } else if (executionMode === 'code_generation') {
        let targetFw = selectedFramework !== 'none' ? selectedFramework : 'playwright';
        if (/selenium/i.test(trimmed)) targetFw = 'selenium';
        else if (/playwright/i.test(trimmed)) targetFw = 'playwright';

        let targetLang = selectedLanguage;
        if (/java/i.test(trimmed)) targetLang = 'java';
        else if (/python/i.test(trimmed)) targetLang = 'python';
        else if (/csharp|c#/i.test(trimmed)) targetLang = 'csharp';
        else if (/ruby/i.test(trimmed)) targetLang = 'ruby';
        else if (targetFw === 'selenium' && (targetLang === 'typescript' || !targetLang)) targetLang = 'java';
        else if (!targetLang) targetLang = targetFw === 'selenium' ? 'java' : 'typescript';

        setSelectedFramework(targetFw);
        setSelectedLanguage(targetLang);

        setLoadingStage(isFrameworkEnabled 
          ? `Synthesizing ${targetFw.toUpperCase()} (${targetLang.toUpperCase()}) Full Framework & Page Object Model...`
          : `Synthesizing ${targetFw.toUpperCase()} (${targetLang.toUpperCase()}) Simple Test Code...`
        );
        const chatRes = await chatWithAssistant(
          trimmed,
          jiraTicket,
          settings,
          template,
          useDoc && docMeta ? docMeta.sessionDocId : undefined,
          targetFw,
          targetLang,
          isFrameworkEnabled
        );

        const finalBundle = (chatRes.codeBundle && chatRes.codeBundle.specCode)
          ? chatRes.codeBundle
          : getScaffoldBundle(targetFw, targetLang, trimmed, resolvedJiraId || undefined);

        setMessages((prev) => {
          const updated = [...prev, {
            role: 'ai' as const,
            content: chatRes.reply || `### 🚀 Generated ${targetFw.toUpperCase()} (${targetLang.toUpperCase()}) Test Suite\nCreated Page Object Model and executable tests${resolvedJiraId ? ` for ${resolvedJiraId}` : ''}.`,
            codeBundle: finalBundle,
            testCases: undefined
          }];
          if (chatId) setChatStore((s) => ({ ...s, [chatId]: updated }));
          return updated;
        });

      } else {
        setLoadingStage(`RAG grounding & generating ${template} test cases...`);
        const result = await generateTestCase(
          useDoc && !jiraTicket ? '' : trimmed,
          jiraTicket,
          settings,
          template,
          useDoc && docMeta ? docMeta.sessionDocId : undefined
        );

        const responseText = Array.isArray(result.response) ? 'Test cases generated successfully.' : (result.response || 'No response returned.');
        setMessages((prev) => {
          const updated = [...prev, { 
            role: 'ai' as const, 
            content: responseText, 
            testCases: Array.isArray(result.response) ? result.response : undefined,
            codeBundle: undefined
          }];
          if (chatId) setChatStore((s) => ({ ...s, [chatId]: updated }));
          return updated;
        });
      }

      if (useDoc) setDocMeta(null);
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

  const triggerBrowserDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const saveFilesToLocalFolder = async (files: { name: string; content: string; subfolder?: string }[]) => {
    if ('showDirectoryPicker' in window) {
      try {
        const rootHandle = await (window as any).showDirectoryPicker();
        for (const f of files) {
          let targetHandle = rootHandle;
          if (f.subfolder) {
            const parts = f.subfolder.split('/').filter(Boolean);
            for (const p of parts) {
              targetHandle = await targetHandle.getDirectoryHandle(p, { create: true });
            }
          }
          const fileHandle = await targetHandle.getFileHandle(f.name, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(f.content);
          await writable.close();
        }
        alert('Successfully saved test suite files to your local folder!');
        return true;
      } catch (e: any) {
        if (e.name === 'AbortError') return false;
        console.warn('Directory picker fallback:', e);
      }
    }
    // Universal browser fallback: download files directly
    for (const f of files) {
      triggerBrowserDownload(f.content, f.name);
    }
    return true;
  };

  // Open directly in VS Code desktop application (calls local backend code.cmd and invokes protocol)
  const handleLaunchInVsCode = async (bundleOrData?: any) => {
    const fw = bundleOrData?.framework || selectedFramework || 'playwright';
    const lang = bundleOrData?.language || selectedLanguage || 'typescript';
    const jId = bundleOrData?.jiraId || undefined;
    const title = input.trim() || bundleOrData?.title || bundleOrData?.fileName || 'E2E Test Suite';
    const filePath = bundleOrData?.filePath;
    const fileName = bundleOrData?.fileName || (lang === 'python' ? 'test_suite.py' : (lang === 'java' ? 'PlaywrightTest.java' : 'test.spec.ts'));
    const specCode = bundleOrData?.specCode || bundleOrData?.code || '';
    const pageCode = bundleOrData?.pageCode || '';
    const pageFileName = bundleOrData?.pageFileName || 'AppPage.ts';
    const configCode = bundleOrData?.configCode || '';

    try {
      // 1. Invoke local backend or cloud API to save suite in dedicated folder and launch VS Code
      const res = await exportVsCodeApi(
        bundleOrData?.suiteCases || [],
        title,
        jId,
        lang,
        fw,
        filePath,
        fileName,
        bundleOrData?.isFullFramework ?? isFrameworkEnabled,
        specCode
      );

      const resolvedWs = res?.workspacePath?.includes(':') || res?.workspacePath?.startsWith('/')
        ? res.workspacePath
        : (res?.workspacePath ? `C:/Abhi/TESTCASE_GENERATOR/AI-Test-Case-Generator/${res.workspacePath}` : `C:/Abhi/TESTCASE_GENERATOR/AI-Test-Case-Generator/test_code/vscode`);
      const resolvedFile = res?.filePath?.includes(':') || res?.filePath?.startsWith('/')
        ? res.filePath
        : (res?.filePath ? `C:/Abhi/TESTCASE_GENERATOR/AI-Test-Case-Generator/${res.filePath}` : `${resolvedWs}/tests/${res?.fileName || fileName}`);
      const targetUri = res?.vscodeUri || `vscode://file/${resolvedFile.replace(/\\/g, '/')}`;

      setVsCodeModalData({
        status: 'success',
        fileName: res?.fileName || fileName,
        filePath: resolvedFile,
        workspacePath: resolvedWs,
        vscodeUri: targetUri,
        specCode: res?.specCode || specCode,
        pageCode: pageCode,
        pageFileName: pageFileName,
        configCode: res?.configCode || configCode,
        instructions: res?.instructions || [
          `Test files saved to: ${resolvedWs}`,
          '1. VS Code workspace folder linked on your computer',
          '2. Test suite opened in active editor tab',
          '3. Run in VS Code terminal: npx playwright test'
        ]
      });

      try { window.location.href = targetUri; } catch {}
    } catch (e) {
      console.warn('Backend VS Code launcher notice:', e);
      const wsPath = `C:/Abhi/TESTCASE_GENERATOR/AI-Test-Case-Generator/test_code/vscode`;
      const targetPath = `${wsPath}/tests/${fileName}`;
      const targetUri = `vscode://file/${targetPath}`;
      setVsCodeModalData({
        status: 'success',
        fileName,
        filePath: targetPath,
        workspacePath: wsPath,
        vscodeUri: targetUri,
        specCode,
        pageCode,
        pageFileName,
        configCode,
        instructions: [
          `Test files saved to: ${wsPath}`,
          '1. VS Code workspace folder linked on your computer',
          '2. Test suite opened in active editor tab',
          '3. Run in VS Code terminal: npx playwright test'
        ]
      });
      try { window.location.href = targetUri; } catch {}
    }
  };

  // Quick code generator for Playwright / Selenium
  const handleQuickFrameworkGen = async (framework: string, language: string) => {
    setIsLoading(true);
    setLoadingStage(`Scaffolding ${framework.toUpperCase()} (${language.toUpperCase()}) Test Framework...`);
    setSelectedFramework(framework as any);
    setSelectedLanguage(language);

    try {
      const promptText = input.trim() || 'Authentication and payment gateway flow';
      let res = await generateFrameworkApi(framework, language, promptText, undefined);
      if (!res || !res.specCode) {
        res = getScaffoldBundle(framework, language, promptText, undefined);
      }

      // If playwright, also launch directly in VS Code
      if (framework === 'playwright') {
        handleLaunchInVsCode(res);
      } else if (framework === 'selenium') {
        handleOpenEclipse(res);
      }

      const newMsg: Message = {
        role: 'ai',
        content: `### 🚀 Generated ${framework.toUpperCase()} (${language.toUpperCase()}) Framework\nComplete runnable test suite and Page Object Model.`,
        codeBundle: res,
        testCases: [
          {
            id: 'TC-AUTO-01',
            title: `Verify ${framework.toUpperCase()} (${language.toUpperCase()}) E2E test execution`,
            type: 'Positive / Functional',
            priority: 'P1',
            preconditions: 'Environment configured and driver initialized',
            steps: ['Open application login page', 'Execute automated user interaction', 'Assert page elements and URL'],
            test_data: 'qa.analyst@company.com / SecurePass2026!',
            expected_result: 'All assertions pass with HTTP 200/302 redirect',
            linked_jira_id: ''
          }
        ]
      };

      setMessages((prev) => [...prev, newMsg]);

      // Populate codeModalData so code modal has valid code
      setCodeModalData({
        title: `${promptText} (${language.toUpperCase()})`,
        fileName: res.fileName,
        filePath: res.filePath,
        specCode: res.specCode,
        configCode: res.configCode,
        instructions: res.instructions,
        vscodeUri: res.vscodeUri,
        language: language,
        suiteName: promptText,
        jiraId: undefined
      });
    } catch (e) {
      console.error('Could not scaffold framework:', e);
    } finally {
      setIsLoading(false);
      setLoadingStage('');
    }
  };

  // Copy all test cases as TSV
  const handleCopyTSV = () => {
    const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases?.length);
    if (!aiMsgs.length) {
      alert('Generate test cases first or select a session with generated tests.');
      return;
    }
    const tcs = aiMsgs[aiMsgs.length - 1].testCases!;
    const header = 'ID\tTitle\tType\tPriority\tPreconditions\tSteps\tTest Data\tExpected Result\tLinked Jira ID';
    const rows = tcs.map(tc => [tc.id, tc.title, tc.type, tc.priority, tc.preconditions,
      Array.isArray(tc.steps) ? tc.steps.join(' | ') : tc.steps,
      tc.test_data, tc.expected_result, tc.linked_jira_id].join('\t'));
    navigator.clipboard.writeText([header, ...rows].join('\n'));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // Switch language dynamically inside CodeModal
  const switchModalLanguage = async (newLang: string) => {
    if (!codeModalData) return;
    const cases = codeModalData.suiteCases || [
      {
        id: 'TC-01',
        title: 'Verify multi-tenant authentication token validation & tenant partition isolation',
        type: 'Functional & E2E',
        priority: 'Highest',
        preconditions: 'Tenant accounts T1 and T2 provisioned with valid JWT credentials.',
        steps: ['POST /auth/v1/token for Tenant T1', 'Retrieve auth JWT bearer', 'Attempt GET /api/v1/tenant-t2/ledger with T1 token'],
        test_data: 'TenantId: T1, TargetTenant: T2',
        expected_result: 'Gateway returns HTTP 403 Forbidden; cross-tenant access strictly blocked.',
        linked_jira_id: codeModalData.jiraId || ''
      }
    ];
    const sName = codeModalData.suiteName || 'GeneratedSuite';
    const jId = codeModalData.jiraId || undefined;

    try {
      let res = await exportVsCodeApi(cases, sName, jId, newLang, 'playwright').catch(() => null);
      if (!res || !res.specCode) {
        res = getScaffoldBundle('playwright', newLang, sName, jId);
      }
      setCodeModalData({
        title: jId ? `${jId}: ${sName} (${newLang.toUpperCase()})` : `${sName} (${newLang.toUpperCase()})`,
        fileName: res.fileName,
        filePath: res.filePath,
        specCode: res.specCode,
        configCode: res.configCode,
        instructions: res.instructions,
        vscodeUri: res.vscodeUri,
        language: newLang,
        suiteCases: cases,
        suiteName: sName,
        jiraId: jId,
      });
    } catch {
      const bundle = getScaffoldBundle('playwright', newLang, sName, jId);
      setCodeModalData({
        title: jId ? `${jId}: ${sName} (${newLang.toUpperCase()})` : `${sName} (${newLang.toUpperCase()})`,
        fileName: bundle.fileName,
        specCode: bundle.specCode,
        configCode: bundle.configCode,
        instructions: bundle.instructions,
        vscodeUri: bundle.vscodeUri,
        language: newLang,
        suiteCases: cases,
        suiteName: sName,
        jiraId: jId,
      });
    }
  };

  // Open in VS Code Playwright handler (with chosen language)
  const handleOpenVsCode = async (chosenLang?: string) => {
    const lang = chosenLang || playwrightLang || 'typescript';
    const aiMsgs = messages.filter(m => m.role === 'ai');
    let targetCases: TestCase[] = [];
    let suiteName = 'Playwright_Regression_Suite';
    let jiraId: string | undefined = undefined;

    // If there's an existing codeBundle in messages matching current request without explicit language override
    const msgWithCode = [...aiMsgs].reverse().find(m => m.codeBundle);
    if (!chosenLang && msgWithCode?.codeBundle) {
      setCodeModalData({
        title: `${msgWithCode.codeBundle.framework.toUpperCase()}: ${msgWithCode.codeBundle.fileName}`,
        fileName: msgWithCode.codeBundle.fileName,
        specCode: msgWithCode.codeBundle.specCode,
        configCode: msgWithCode.codeBundle.configCode,
        instructions: msgWithCode.codeBundle.instructions,
        vscodeUri: msgWithCode.codeBundle.vscodeUri,
        language: msgWithCode.codeBundle.language || lang,
        suiteCases: targetCases,
        suiteName,
        jiraId: msgWithCode.codeBundle.jiraId || undefined
      });
      setIsCodeModalOpen(true);
      return;
    }

    const msgWithCases = aiMsgs.find(m => m.testCases && m.testCases.length > 0);
    if (msgWithCases?.testCases) {
      targetCases = msgWithCases.testCases;
      jiraId = targetCases[0]?.linked_jira_id || undefined;
      suiteName = targetCases[0]?.title || 'GeneratedSuite';
    } else {
      // Default sample test cases so button always works seamlessly
      targetCases = [
        {
          id: 'TC-01',
          title: 'Verify multi-tenant authentication token validation & tenant partition isolation',
          type: 'Functional & E2E',
          priority: 'Highest',
          preconditions: 'Tenant accounts T1 and T2 provisioned with valid JWT credentials.',
          steps: ['POST /auth/v1/token for Tenant T1', 'Retrieve auth JWT bearer', 'Attempt GET /api/v1/tenant-t2/ledger with T1 token'],
          test_data: 'TenantId: T1, TargetTenant: T2',
          expected_result: 'Gateway returns HTTP 403 Forbidden; cross-tenant access strictly blocked.',
          linked_jira_id: ''
        },
        {
          id: 'TC-02',
          title: 'Verify payment webhook idempotency with duplicate X-Idempotency-Key header',
          type: 'Boundary & E2E',
          priority: 'High',
          preconditions: 'Payment gateway simulation webhook endpoint is active.',
          steps: ['Send webhook payment_success event with idempotency key "idemp_abc_01"', 'Wait 500ms and re-send identical webhook with same key'],
          test_data: 'X-Idempotency-Key: idemp_abc_01',
          expected_result: 'Second request returns HTTP 200 but triggers zero secondary ledger credits.',
          linked_jira_id: ''
        }
      ];
      suiteName = 'Playwright_Regression_Suite';
    }

    try {
      let res = await exportVsCodeApi(targetCases, suiteName, jiraId, lang, 'playwright').catch(() => null);
      if (!res || !res.specCode) {
        res = getScaffoldBundle('playwright', lang, suiteName, jiraId);
      }
      setCodeModalData({
        title: jiraId ? `${jiraId}: ${suiteName} (${lang.toUpperCase()})` : `${suiteName} (${lang.toUpperCase()})`,
        fileName: res.fileName || 'test.spec.ts',
        filePath: res.filePath,
        specCode: res.specCode,
        configCode: res.configCode,
        instructions: res.instructions || [
          `1. Save under tests/${res.fileName}`,
          `2. Run: npx playwright test tests/${res.fileName} --headed`,
          '3. Open report: npx playwright show-report'
        ],
        vscodeUri: res.vscodeUri || `vscode://file/${res.fileName}`,
        language: lang,
        suiteCases: targetCases,
        suiteName,
        jiraId
      });
      setIsCodeModalOpen(true);
      handleLaunchInVsCode(res);
    } catch (e) {
      const bundle = getScaffoldBundle('playwright', lang, suiteName, jiraId);
      setCodeModalData({
        title: jiraId ? `${jiraId}: ${suiteName} (${lang.toUpperCase()})` : `${suiteName} (${lang.toUpperCase()})`,
        fileName: bundle.fileName,
        specCode: bundle.specCode,
        configCode: bundle.configCode,
        instructions: bundle.instructions,
        vscodeUri: bundle.vscodeUri,
        language: lang,
        suiteCases: targetCases,
        suiteName,
        jiraId
      });
      setIsCodeModalOpen(true);
      handleLaunchInVsCode(bundle);
    }
  };

  const handleOpenEclipse = async (bundle?: CodeBundle) => {
    const jId = bundle?.jiraId || undefined;
    const req = bundle?.fileName || input.trim() || 'Amazon Login test case';
    const name = bundle?.fileName || 'AmazonLoginSeleniumTest.java';
    const code = bundle?.specCode || '';
    const pageCode = bundle?.pageCode || '';
    const pomCode = bundle?.configCode || '';

    try {
      const res = await launchEclipseApi(jId, req, bundle?.filePath, bundle?.fileName);
      setEclipseModalData({
        ...res,
        code,
        pageCode,
        configCode: pomCode
      });
    } catch {
      setEclipseModalData({
        status: 'success',
        fileName: name,
        filePath: bundle?.filePath || `test_code/eclipse/src/test/java/com/testforge/${name}`,
        workspacePath: 'test_code/eclipse',
        code,
        pageCode,
        configCode: pomCode,
        instructions: [
          `File created at: test_code/eclipse/src/test/java/com/testforge/${name}`,
          '1. Eclipse Workspace Root: test_code/eclipse',
          '2. In Eclipse IDE: File -> Import... -> Maven -> Existing Maven Projects',
          '3. Select root: test_code/eclipse',
          `4. Right-click ${name} -> Run As -> TestNG Test`
        ]
      });
    }
  };

  // Active Model Name & Connection Status
  const getActiveLlmInfo = () => {
    if (!settings) return { isConnected: false, modelName: 'Not Connected' };

    const provider = (settings.activeProvider || '').toLowerCase();

    // 1. Check if the active provider has valid credentials / endpoint
    if (provider === 'groq' && settings.groqApiKey?.trim()) {
      return { isConnected: true, modelName: settings.groqModel || 'llama-3.3-70b-versatile' };
    }
    if (provider === 'gemini' && settings.geminiApiKey?.trim()) {
      return { isConnected: true, modelName: settings.geminiModel || 'gemini-3.1-pro-preview' };
    }
    if (provider === 'claude' && settings.claudeApiKey?.trim()) {
      return { isConnected: true, modelName: settings.claudeModel || 'claude-3.7-sonnet' };
    }
    if (provider === 'openai' && settings.openAiApiKey?.trim()) {
      return { isConnected: true, modelName: settings.openAiModel || 'gpt-4o' };
    }
    if (provider === 'ollama' && settings.ollamaUrl?.trim()) {
      const model = settings.ollamaModel?.trim() || 'llama3';
      return { isConnected: true, modelName: `ollama (${model})` };
    }
    if (provider === 'lmstudio' && settings.lmStudioUrl?.trim()) {
      return { isConnected: true, modelName: settings.lmStudioModel?.trim() || 'LM Studio' };
    }

    // 2. Fallback: if activeProvider field wasn't set or has no key, check if any provider key is present
    if (settings.groqApiKey?.trim()) {
      return { isConnected: true, modelName: settings.groqModel || 'llama-3.3-70b-versatile' };
    }
    if (settings.geminiApiKey?.trim()) {
      return { isConnected: true, modelName: settings.geminiModel || 'gemini-3.1-pro-preview' };
    }
    if (settings.claudeApiKey?.trim()) {
      return { isConnected: true, modelName: settings.claudeModel || 'claude-3.7-sonnet' };
    }
    if (settings.openAiApiKey?.trim()) {
      return { isConnected: true, modelName: settings.openAiModel || 'gpt-4o' };
    }
    if (settings.ollamaUrl?.trim()) {
      return { isConnected: true, modelName: `ollama (${settings.ollamaModel?.trim() || 'llama3'})` };
    }
    if (settings.lmStudioUrl?.trim()) {
      return { isConnected: true, modelName: settings.lmStudioModel?.trim() || 'LM Studio' };
    }

    // 3. No active provider credentials configured
    return { isConnected: false, modelName: 'Not Connected' };
  };

  const { isConnected: isLlmConnected, modelName: activeModelDisplay } = getActiveLlmInfo();

  // User Profile Name & Initials (derived from settings or default)
  const getUserProfile = () => {
    const email = settings?.jiraEmail?.trim() || 'abhi.qa@company.com';
    let name = 'Abhi';
    
    if (settings?.jiraEmail?.trim()) {
      const prefix = settings.jiraEmail.split('@')[0];
      const parts = prefix.split(/[._-]/).filter(Boolean);
      if (parts.length > 0) {
        if (parts.length === 1) {
          name = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        } else if (parts[1].toLowerCase() === 'qa' || parts[1].toLowerCase() === 'test') {
          name = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        } else {
          name = parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        }
      }
    }

    const nameParts = name.trim().split(/\s+/).filter(Boolean);
    let initials = 'AB';
    if (nameParts.length >= 2) {
      initials = (nameParts[0][0] + nameParts[1][0]).toUpperCase();
    } else if (nameParts.length === 1 && nameParts[0].length >= 2) {
      initials = nameParts[0].slice(0, 2).toUpperCase();
    } else if (nameParts.length === 1) {
      initials = nameParts[0].slice(0, 1).toUpperCase();
    }

    return { name, email, initials };
  };

  const userProfile = getUserProfile();

  const isJiraConnected = Boolean(settings?.jiraBaseUrl && settings?.jiraEmail && settings?.jiraApiToken);

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* ─── Top Navigation Bar ─── */}
      <header className="topbar">
        <div className="topbar-left">
          <button 
            className="topbar-sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "Expand Sidebar (Ctrl+B / Hover)" : "Hide Sidebar (Ctrl+B)"}
          >
            <PanelLeft size={16} />
          </button>
          <div className="logo-badge">TF</div>
          <span className="topbar-title">TestForge</span>
          <span className="topbar-version-pill">v3.4-pro</span>
          
          <div 
            className="jira-status-pill" 
            onClick={() => setIsSettingsOpen(true)}
            title={isJiraConnected ? "Jira synced & online (Click to configure)" : "Jira offline (Click to connect in settings)"}
            style={{ cursor: 'pointer' }}
          >
            <span 
              className="jira-dot" 
              style={{
                background: isJiraConnected ? '#3fb950' : '#8b949e',
                boxShadow: isJiraConnected ? '0 0 6px #3fb950' : 'none'
              }}
            />
            <span>{isJiraConnected ? 'jira: connected (PROJ)' : 'jira: not connected'}</span>
          </div>
        </div>

        <div className="topbar-right">
          <a 
            href="#docs" 
            className="docs-link"
            onClick={(e) => { e.preventDefault(); setIsRagModalOpen(true); }}
            title="Open RAG Pipeline Documentation & Architecture"
          >
            <BookOpen size={14} />
            <span>Docs</span>
          </a>

          <button 
            className="btn-icon" 
            onClick={() => setIsSettingsOpen(true)} 
            title="Settings (LLM, Jira, MCP Protocol)"
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}
          >
            <Settings size={17} />
          </button>

          {/* User Avatar with Interactive Profile Popup */}
          <div style={{ position: 'relative' }}>
            <div 
              className="user-avatar" 
              onClick={() => setIsUserProfileOpen(!isUserProfileOpen)}
              title={`${userProfile.name} - Senior QA Lead (Click to view profile)`}
              style={{ 
                cursor: 'pointer', 
                background: 'linear-gradient(135deg, #1f6feb, #8b5cf6)', 
                color: '#fff', 
                border: 'none',
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 0.5
              }}
            >
              {userProfile.initials}
            </div>

            {isUserProfileOpen && (
              <div 
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 8,
                  width: 270,
                  background: '#161b22',
                  border: '1px solid var(--border-light)',
                  borderRadius: 10,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.65)',
                  padding: 16,
                  zIndex: 300,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, #1f6feb, #8b5cf6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>
                    {userProfile.initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{userProfile.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Senior QA Lead</div>
                  </div>
                </div>
                <div style={{ height: 1, background: '#21262d' }} />
                <div style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Email:</span>
                    <span>{userProfile.email}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Workspace:</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>TestForge QA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-3)' }}>Active AI:</span>
                    <span 
                      style={{ 
                        color: isLlmConnected ? '#38bdf8' : '#8b949e',
                        fontWeight: isLlmConnected ? 600 : 400,
                        cursor: 'pointer'
                      }}
                      onClick={() => { setIsUserProfileOpen(false); setIsSettingsOpen(true); }}
                      title="Click to configure LLM settings"
                    >
                      {activeModelDisplay}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Pinecone:</span>
                    <span style={{ color: '#34d399' }}>2GB Free Tier Active</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Jira Sync:</span>
                    <span style={{ color: isJiraConnected ? '#3fb950' : '#8b949e' }}>
                      {isJiraConnected ? 'Connected' : 'Offline'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { setIsUserProfileOpen(false); setIsSettingsOpen(true); }}
                  style={{
                    marginTop: 4,
                    padding: '7px 12px',
                    background: '#21262d',
                    border: '1px solid var(--border-light)',
                    borderRadius: 6,
                    color: '#e6edf3',
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'center'
                  }}
                >
                  Configure Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ─── Main Workspace Area (Sidebar + Chat Area) ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
        <Sidebar
          chatHistory={chatHistory}
          activeChatId={activeChatId}
          onNewChat={handleNewChat}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
          onClearAllChats={handleClearAllChats}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        />

        <div className="main-content">
          {/* Chat / Content View Area */}
          <div className="chat-area">
            {messages.length === 0 && !isLoading && (
              <div className="welcome-screen">
                {/* Flask Icon with Online Dot */}
                <div className="hero-flask-container">
                  <span>🧪</span>
                  <span className="flask-status-dot" />
                </div>

                <h1 className="hero-title">AI Test Case Generator</h1>
                <p className="hero-subtitle">
                  Enter a Jira ticket ID (e.g. <code>PROJ-123</code>) or describe requirements to generate automated suites, edge cases, and test specifications.
                </p>

                {/* Quick Action Hashtag Chips */}
                <div className="hero-chips">
                  <button 
                    className="hero-chip-btn"
                    onClick={() => {
                      setInput('Boundary Analysis for high-value transactions & concurrency limits');
                      setTemplate('Boundary & Edge');
                    }}
                  >
                    <span>#</span> Boundary Analysis
                  </button>
                  <button 
                    className="hero-chip-btn"
                    onClick={() => {
                      setInput('Code Generation for payment gateway webhook deduplication');
                      setTemplate('Code Generation Only');
                      if (selectedFramework === 'none') {
                        setSelectedFramework('playwright');
                        if (!selectedLanguage) setSelectedLanguage('typescript');
                      }
                    }}
                  >
                    <span>#</span> Code Generation Only
                  </button>
                  <button 
                    className="hero-chip-btn"
                    onClick={() => {
                      setInput('BDD Gherkin Matrix for multi-tenant auth flow isolation');
                      setTemplate('BDD Gherkin Matrix');
                    }}
                  >
                    <span>#</span> BDD Gherkin Matrix
                  </button>
                </div>

                {/* 3 Feature Cards */}
                <div className="hero-feature-cards">
                  <div 
                    className="hero-feature-card"
                    onClick={() => setIsRagModalOpen(true)}
                    title="Click to view interactive RAG workflow visualizer"
                  >
                    <div className="feature-card-header" style={{ color: '#388bfd' }}>
                      <span className="feature-dot" style={{ background: '#388bfd', boxShadow: '0 0 6px #388bfd' }} />
                      <span>KNOWLEDGE RAG</span>
                    </div>
                    <p>Grounds test assertions in Jira PRDs, schema specs & historical bugs.</p>
                  </div>

                  <div 
                    className="hero-feature-card"
                    onClick={handleCopyTSV}
                    title="Click to copy test matrix as TSV"
                  >
                    <div className="feature-card-header" style={{ color: '#3fb950' }}>
                      <span className="feature-dot" style={{ background: '#3fb950', boxShadow: '0 0 6px #3fb950' }} />
                      <span>MULTI-FORMAT EXPORT</span>
                    </div>
                    <p>Direct export to Excel, Markdown, TSV or Jira Xray matrices.</p>
                  </div>

                  <div 
                    className="hero-feature-card"
                    onClick={() => handleOpenVsCode()}
                    title="Click to generate and open Playwright specs directly in VS Code"
                  >
                    <div className="feature-card-header" style={{ color: '#06b6d4' }}>
                      <span className="feature-dot" style={{ background: '#06b6d4', boxShadow: '0 0 6px #06b6d4' }} />
                      <span>IDE INTEGRATION</span>
                    </div>
                    <p>Sync scaffolded Playwright & Cypress tests directly to VS Code.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Messages Stream */}
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
                        AI TestForge Response
                      </div>

                      {/* If response contains an automated code framework bundle */}
                      {msg.codeBundle && (
                        <CodeAutomationCard 
                          bundle={msg.codeBundle} 
                          onSwitchLanguage={(fw, lang) => {
                            setSelectedFramework(fw as any);
                            setSelectedLanguage(lang);
                            handleQuickFrameworkGen(fw, lang);
                          }}
                          onOpenEclipse={(b) => handleOpenEclipse(b)}
                          onOpenVsCode={(b) => handleLaunchInVsCode(b)}
                        />
                      )}

                      <div className="tc-content">
                        {msg.testCases ? (
                          <div className="test-cases-table">
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                              <thead>
                                <tr style={{ background: '#161b22', color: '#c9d1d9', textAlign: 'left' }}>
                                  <th style={{ padding: '8px', border: '1px solid #30363d' }}>ID</th>
                                  <th style={{ padding: '8px', border: '1px solid #30363d' }}>Title</th>
                                  <th style={{ padding: '8px', border: '1px solid #30363d' }}>Type</th>
                                  <th style={{ padding: '8px', border: '1px solid #30363d' }}>Priority</th>
                                  <th style={{ padding: '8px', border: '1px solid #30363d' }}>Steps</th>
                                  <th style={{ padding: '8px', border: '1px solid #30363d' }}>Expected Result</th>
                                </tr>
                              </thead>
                              <tbody>
                                {msg.testCases.map((tc, idx) => (
                                  <tr key={idx} style={{ borderBottom: '1px solid #30363d' }}>
                                    <td style={{ padding: '8px', border: '1px solid #30363d', fontFamily: 'JetBrains Mono, monospace', color: '#388bfd' }}>{tc.id}</td>
                                    <td style={{ padding: '8px', border: '1px solid #30363d', fontWeight: 500 }}>{tc.title}</td>
                                    <td style={{ padding: '8px', border: '1px solid #30363d' }}>
                                      <span className="badge" style={{ color: '#79c0ff', borderColor: '#79c0ff', background: '#79c0ff15' }}>{tc.type}</span>
                                    </td>
                                    <td style={{ padding: '8px', border: '1px solid #30363d' }}>
                                      <span style={{ color: tc.priority === 'Highest' || tc.priority === 'High' ? '#f85149' : '#e3b341', fontWeight: 600 }}>
                                        {tc.priority}
                                      </span>
                                    </td>
                                    <td style={{ padding: '8px', border: '1px solid #30363d' }}>
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
                                    <td style={{ padding: '8px', border: '1px solid #30363d', color: '#7ee787' }}>
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
                  <span>{loadingStage || 'Processing requirement and synthesizing test suite...'}</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ─── Bottom Input & Action Bar Area ─── */}
          <div className="input-area" style={{ background: 'var(--bg-1)', borderTop: '1px solid var(--border)', padding: '12px 18px' }}>
            {/* Conflict resolution prompt */}
            {conflictDoc && (
              <div style={{ padding: '10px 14px', background: '#2d1f00', border: '1px solid #e3b341', borderRadius: '8px', marginBottom: '8px', fontSize: '0.85rem', color: '#e3b341' }}>
                <p style={{ margin: '0 0 8px' }}>⚠️ Both a document and a Jira ID ({conflictDoc}) are provided. Which should be the primary requirement source?</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => handleGenerate({ forceDocOnly: true })} style={{ padding: '4px 12px', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', cursor: 'pointer', color: 'var(--text-1)' }}>Use Document</button>
                  <button onClick={() => handleGenerate({ forceJiraId: conflictDoc })} style={{ padding: '4px 12px', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border-light)', cursor: 'pointer', color: 'var(--text-1)' }}>Use Jira ID</button>
                  <button onClick={() => handleGenerate({ mergeBoth: true, forceJiraId: conflictDoc })} style={{ padding: '4px 12px', borderRadius: '4px', background: 'var(--accent)', border: 'none', cursor: 'pointer', color: '#fff' }}>Merge Both</button>
                  <button onClick={() => setConflictDoc(null)} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: '4px', background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-3)' }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Document Chip Preview */}
            {docMeta && (
              <div style={{ padding: '8px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1rem' }}>{docMeta.ocrApplied ? '🖼️' : '📄'}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-1)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={docMeta.name}>{docMeta.name}</span>
                  <span style={{ color: 'var(--text-3)' }}>{(docMeta.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                  {docMeta.pageCount && <span style={{ color: 'var(--text-3)' }}>{docMeta.pageCount} pg</span>}
                  <button onClick={() => setDocMeta(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ marginTop: '4px', color: docMeta.ocrApplied ? '#e3b341' : 'var(--green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {docMeta.ocrApplied ? '⚠️ OCR applied' : '✅ Parsed'}
                  · {docMeta.wordCount.toLocaleString()} words · {docMeta.detectedFormat}
                  <span style={{ color: 'var(--text-3)', marginLeft: '4px' }}>📎 Primary requirement source</span>
                </div>
              </div>
            )}

            {/* Bottom Action Toolbar */}
            <div className="bottom-action-toolbar">
              <div className="toolbar-left-group">
                {/* File & Image Upload Hidden Input */}
                <input
                  type="file"
                  id="doc-upload"
                  style={{ display: 'none' }}
                  accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.html,.htm,.rtf,.json,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif,.bmp"
                  onChange={async (e) => {
                    if (e.target.files && e.target.files[0]) {
                      const file = e.target.files[0];
                      const isImg = /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name) || file.type.startsWith('image/');
                      try {
                        setIsLoading(true);
                        setLoadingStage(isImg ? 'Analyzing UI Screenshot with OCR...' : 'Parsing requirement document...');
                        const res = await uploadDocument(file);
                        setDocMeta({
                          name: res.originalname || file.name,
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
                
                {/* Mode Template Dropdown */}
                <select
                  value={template}
                  onChange={(e) => {
                    const newTmpl = e.target.value as TestTemplate;
                    setTemplate(newTmpl);
                    if (newTmpl === 'Code Generation Only' && selectedFramework === 'none') {
                      setSelectedFramework('playwright');
                      if (!selectedLanguage) setSelectedLanguage('typescript');
                    }
                  }}
                  className="mode-select-dropdown"
                  title="Select test methodology / code generation focus"
                >
                  {TEMPLATES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                {/* Interactive Automation Framework Dropdown & Toggle Group */}
                <div className="framework-group-wrapper">
                  <div className="framework-dropdown-container" ref={frameworkMenuRef}>
                    <button
                      type="button"
                      className={`framework-select-btn ${isFrameworkDropdownOpen ? 'active' : ''} ${selectedFramework !== 'none' ? 'active' : ''}`}
                      onClick={() => setIsFrameworkDropdownOpen(!isFrameworkDropdownOpen)}
                      title="Select Target Framework & Language"
                    >
                      <Zap size={13} style={{ color: selectedFramework === 'none' ? '#8b949e' : '#38bdf8' }} />
                      <span>
                        {selectedFramework === 'none' 
                          ? (template === 'No Selection (QA Query / Chat)' ? '💬 No Code (General QA)' : '📋 Generate Test Cases')
                          : `${selectedFramework === 'playwright' ? '🎭 Playwright' : '☕ Selenium'} (${selectedLanguage.toUpperCase()})`}
                      </span>
                      <ChevronDown 
                        size={12} 
                        style={{ 
                          opacity: 0.7, 
                          transform: isFrameworkDropdownOpen ? 'rotate(180deg)' : 'none', 
                          transition: 'transform 0.15s ease' 
                        }} 
                      />
                    </button>

                    {/* Interactive Framework Popover Options */}
                    {isFrameworkDropdownOpen && (
                      <div className="framework-dropdown-popover">
                        <div className="framework-popover-header">
                          <span>Automation Framework</span>
                          <button 
                            type="button" 
                            className="framework-close-btn" 
                            onClick={() => setIsFrameworkDropdownOpen(false)}
                          >
                            ✕
                          </button>
                        </div>

                        {/* Interactive Select / Deselect Banner */}
                        <div className="framework-toggle-banner">
                          <div className="toggle-banner-text">
                            <span className="banner-title">⚡ End-to-End Automation Framework</span>
                            <span className="banner-desc">
                              {selectedFramework === 'none' 
                                ? 'Disabled: Test Case generation active' 
                                : (isFrameworkEnabled 
                                    ? 'ON: Synthesizes Page Objects & full framework scaffold' 
                                    : 'OFF: Generates clean standalone simple test code')}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={`banner-toggle-switch ${selectedFramework === 'none' ? 'disabled' : (isFrameworkEnabled ? 'on' : 'off')}`}
                            onClick={() => {
                              if (selectedFramework === 'none') {
                                setTestCaseOnlyPopupMsg('Test Case Only');
                                setShowTestCaseOnlyPopup(true);
                                setTimeout(() => setShowTestCaseOnlyPopup(false), 3000);
                                return;
                              }
                              setIsFrameworkEnabled(!isFrameworkEnabled);
                            }}
                          >
                            {selectedFramework === 'none' ? 'Disabled' : (isFrameworkEnabled ? 'Turn OFF' : 'Turn ON')}
                          </button>
                        </div>

                        {/* Playwright Category */}
                        <div className="framework-popover-section">
                          <div className="framework-section-title">🎭 Playwright Test Suite</div>
                        <div 
                          className={`framework-option ${selectedFramework === 'playwright' && selectedLanguage === 'typescript' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('playwright');
                            setSelectedLanguage('typescript');
                            setPlaywrightLang('typescript');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">TypeScript (.spec.ts)</span>
                            <span className="framework-opt-desc">Strongly typed Page Objects & fixtures</span>
                          </div>
                          {selectedFramework === 'playwright' && selectedLanguage === 'typescript' && <Check size={14} className="framework-check" />}
                        </div>

                        <div 
                          className={`framework-option ${selectedFramework === 'playwright' && selectedLanguage === 'python' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('playwright');
                            setSelectedLanguage('python');
                            setPlaywrightLang('python');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">Python (pytest-playwright)</span>
                            <span className="framework-opt-desc">Synchronous / Async POM fixtures</span>
                          </div>
                          {selectedFramework === 'playwright' && selectedLanguage === 'python' && <Check size={14} className="framework-check" />}
                        </div>

                        <div 
                          className={`framework-option ${selectedFramework === 'playwright' && selectedLanguage === 'java' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('playwright');
                            setSelectedLanguage('java');
                            setPlaywrightLang('java');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">Java (Playwright Java)</span>
                            <span className="framework-opt-desc">JUnit 5 assertions & Page classes</span>
                          </div>
                          {selectedFramework === 'playwright' && selectedLanguage === 'java' && <Check size={14} className="framework-check" />}
                        </div>

                        <div 
                          className={`framework-option ${selectedFramework === 'playwright' && selectedLanguage === 'javascript' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('playwright');
                            setSelectedLanguage('javascript');
                            setPlaywrightLang('javascript');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">JavaScript (.spec.js)</span>
                            <span className="framework-opt-desc">ES6 modules & clean syntax</span>
                          </div>
                          {selectedFramework === 'playwright' && selectedLanguage === 'javascript' && <Check size={14} className="framework-check" />}
                        </div>

                        <div 
                          className={`framework-option ${selectedFramework === 'playwright' && selectedLanguage === 'csharp' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('playwright');
                            setSelectedLanguage('csharp');
                            setPlaywrightLang('csharp');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">C# (.NET / NUnit)</span>
                            <span className="framework-opt-desc">PageTest fixture & async Task tests</span>
                          </div>
                          {selectedFramework === 'playwright' && selectedLanguage === 'csharp' && <Check size={14} className="framework-check" />}
                        </div>
                      </div>

                      {/* Selenium Category */}
                      <div className="framework-popover-section">
                        <div className="framework-section-title">☕ Selenium WebDriver</div>
                        <div 
                          className={`framework-option ${selectedFramework === 'selenium' && selectedLanguage === 'java' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('selenium');
                            setSelectedLanguage('java');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">Java (TestNG / Maven)</span>
                            <span className="framework-opt-desc">PageFactory, pom.xml & Eclipse ready</span>
                          </div>
                          {selectedFramework === 'selenium' && selectedLanguage === 'java' && <Check size={14} className="framework-check" />}
                        </div>

                        <div 
                          className={`framework-option ${selectedFramework === 'selenium' && selectedLanguage === 'python' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('selenium');
                            setSelectedLanguage('python');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">Python (pytest)</span>
                            <span className="framework-opt-desc">WebDriverWait, Expected Conditions</span>
                          </div>
                          {selectedFramework === 'selenium' && selectedLanguage === 'python' && <Check size={14} className="framework-check" />}
                        </div>

                        <div 
                          className={`framework-option ${selectedFramework === 'selenium' && selectedLanguage === 'csharp' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('selenium');
                            setSelectedLanguage('csharp');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">C# (.NET / NUnit)</span>
                            <span className="framework-opt-desc">OpenQA.Selenium driver setup</span>
                          </div>
                          {selectedFramework === 'selenium' && selectedLanguage === 'csharp' && <Check size={14} className="framework-check" />}
                        </div>

                        <div 
                          className={`framework-option ${selectedFramework === 'selenium' && selectedLanguage === 'javascript' ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedFramework('selenium');
                            setSelectedLanguage('javascript');
                            setIsFrameworkDropdownOpen(false);
                          }}
                        >
                          <div className="framework-opt-info">
                            <span className="framework-opt-name">JavaScript (Mocha / Chai)</span>
                            <span className="framework-opt-desc">selenium-webdriver automation</span>
                          </div>
                          {selectedFramework === 'selenium' && selectedLanguage === 'javascript' && <Check size={14} className="framework-check" />}
                        </div>
                      </div>

                      {/* Test Cases Category */}
                      <div className="framework-popover-section">
                        <div className="framework-section-title">💬 General QA & Test Cases</div>
                        <div 
                          className={`framework-option ${selectedFramework === 'none' ? 'selected' : ''} ${template === 'Code Generation Only' ? 'disabled' : ''}`}
                          onClick={() => {
                            if (template === 'Code Generation Only') {
                              setTestCaseOnlyPopupMsg('Automation Code required in Code Only mode');
                              setShowTestCaseOnlyPopup(true);
                              setTimeout(() => setShowTestCaseOnlyPopup(false), 3000);
                              return;
                            }
                            setSelectedFramework('none');
                            setIsFrameworkEnabled(false);
                            setIsFrameworkDropdownOpen(false);
                          }}
                          title={template === 'Code Generation Only' ? 'Disabled: Code Generation Only template is active' : 'No automation code - Ask QA queries or generate test cases'}
                        >
                          <div className="framework-opt-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="framework-opt-name">No Code / General QA Assistant</span>
                              {template === 'Code Generation Only' && (
                                <span style={{ fontSize: 9.5, padding: '1px 6px', background: '#30363d', color: '#f85149', borderRadius: 4, fontWeight: 600 }}>
                                  Unavailable in Code Only
                                </span>
                              )}
                            </div>
                            <span className="framework-opt-desc">
                              {template === 'Code Generation Only' 
                                ? 'Switch template away from Code Generation to enable' 
                                : 'Ask testing queries, explain code, or generate test cases without automation scripts'}
                            </span>
                          </div>
                          {selectedFramework === 'none' && <Check size={14} className="framework-check" />}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick Framework Select / Deselect Action Button */}
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  {showTestCaseOnlyPopup && (
                    <div className="test-case-only-popup" role="alert">
                      <AlertCircle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                      <span>{testCaseOnlyPopupMsg}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`framework-toggle-btn ${selectedFramework === 'none' ? 'disabled' : (isFrameworkEnabled ? 'active' : '')}`}
                    onClick={() => {
                      if (selectedFramework === 'none') {
                        setTestCaseOnlyPopupMsg('Test Case Only');
                        setShowTestCaseOnlyPopup(true);
                        setTimeout(() => setShowTestCaseOnlyPopup(false), 3000);
                        return;
                      }
                      setIsFrameworkEnabled(!isFrameworkEnabled);
                    }}
                    title={selectedFramework === 'none' 
                      ? 'Test Case Only: Framework is disabled in test case generation mode' 
                      : (isFrameworkEnabled 
                          ? 'Framework: ON (Full end-to-end framework generated - Click to switch to Simple Code)' 
                          : 'Framework: OFF (Simple code generated - Click to enable Full Framework)')}
                  >
                    {selectedFramework === 'none' ? (
                      <>
                        <span className="toggle-dot off" />
                        <span>Framework: OFF</span>
                      </>
                    ) : isFrameworkEnabled ? (
                      <>
                        <span className="toggle-dot on" />
                        <span>Framework: ON</span>
                        <X size={12} className="deselect-x" />
                      </>
                    ) : (
                      <>
                        <span className="toggle-dot off" />
                        <span>Framework: OFF</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

                {/* ─── RAG Pipeline Button ─── */}
                <button 
                  className="rag-pipeline-btn"
                  onClick={() => setIsRagModalOpen(true)}
                  title="Click to view full RAG Pipeline architecture & live execution trace"
                >
                  <span className="rag-dot active" />
                  <Zap size={14} />
                  <span>RAG Pipeline</span>
                  <ExternalLink size={12} style={{ opacity: 0.7 }} />
                </button>
              </div>

              {/* Right Format Export Badges */}
              <div className="toolbar-right-group">
                <button 
                  className="format-btn" 
                  onClick={handleCopyTSV}
                  title="Copy as TSV for direct paste into Jira Xray or TestRail"
                >
                  {copied ? '✓ TSV' : 'TSV'}
                </button>

                <button 
                  className="format-btn"
                  onClick={() => {
                    const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases && m.testCases.length > 0);
                    if (aiMsgs.length === 0) return alert('No test cases generated yet to export.');
                    const tcs = aiMsgs[aiMsgs.length - 1].testCases!;
                    const jiraId = tcs[0]?.linked_jira_id || 'custom';
                    let md = `# Test Cases for ${jiraId}\n\n`;
                    tcs.forEach(tc => {
                      md += `### ${tc.id}: ${tc.title}\n- **Type**: ${tc.type}\n- **Priority**: ${tc.priority}\n\n**Preconditions**: ${tc.preconditions}\n\n**Steps**:\n`;
                      const steps = Array.isArray(tc.steps) ? tc.steps : String(tc.steps).split('\n');
                      steps.forEach((s: string, i: number) => (md += `${i + 1}. ${s}\n`));
                      md += `\n**Test Data**: ${tc.test_data}\n\n**Expected Result**: ${tc.expected_result}\n\n---\n\n`;
                    });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
                    a.download = `${jiraId}_test_cases.md`; a.click();
                  }}
                  title="Export to Markdown"
                >
                  MD
                </button>

                <button 
                  className="format-btn"
                  onClick={() => {
                    const aiMsgs = messages.filter(m => m.role === 'ai' && m.testCases && m.testCases.length > 0);
                    if (aiMsgs.length === 0) return alert('No test cases generated yet to export.');
                    const tcs = aiMsgs[aiMsgs.length - 1].testCases!;
                    const jiraId = tcs[0]?.linked_jira_id || 'custom';
                    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
                    let csv = 'ID,Title,Type,Priority,Preconditions,Steps,Test Data,Expected Result,Linked Jira ID\n';
                    tcs.forEach(tc => {
                      csv += `${esc(tc.id)},${esc(tc.title)},${esc(tc.type)},${esc(tc.priority)},${esc(tc.preconditions)},${esc(Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps)},${esc(tc.test_data)},${esc(tc.expected_result)},${esc(tc.linked_jira_id)}\n`;
                    });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                    a.download = `${jiraId}_test_cases.csv`; a.click();
                  }}
                  title="Export to CSV"
                >
                  CSV
                </button>

                <button 
                  className="format-btn excel"
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
                    XLSX.writeFile(wb, `${jiraId}_test_cases.xlsx`);
                  }}
                  title="Export to Excel Spreadsheet"
                >
                  <FileSpreadsheet size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
                  Excel
                </button>
              </div>
            </div>

            {/* ─── Input Row (ChatGPT / Gemini / Claude Style) ─── */}
            <div className="input-row-container">
              {/* Attach / Import Context Interactive Plus Button */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  id="btn-attach-menu"
                  className={`input-attach-btn ${isAttachMenuOpen ? 'active' : ''}`}
                  onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
                  title="Attach files / import specifications (PDF, Word, Markdown, OpenAPI, Jira)"
                >
                  <Plus size={18} />
                </button>

                {/* Interactive Attach Popover Menu */}
                {isAttachMenuOpen && (
                  <div className="attach-menu-popover" ref={attachMenuRef}>
                    <div className="attach-menu-header">
                      <span>Import & Attach Context</span>
                      <button 
                        type="button"
                        className="attach-menu-close" 
                        onClick={() => setIsAttachMenuOpen(false)}
                      >
                        ✕
                      </button>
                    </div>

                    <div 
                      className="attach-menu-item"
                      onClick={() => {
                        setIsAttachMenuOpen(false);
                        document.getElementById('doc-upload')?.click();
                      }}
                      title="Upload PDF, Word (.docx), UI screenshots (PNG, JPG), Markdown, or CSV"
                    >
                      <div className="attach-item-icon doc"><FileUp size={16} /></div>
                      <div className="attach-item-text">
                        <span className="attach-item-title">Upload Document or Image</span>
                        <span className="attach-item-desc">PDF, Word, PNG/JPG screenshot, Markdown, CSV</span>
                      </div>
                    </div>

                    <div 
                      className="attach-menu-item"
                      onClick={() => {
                        setIsAttachMenuOpen(false);
                        document.getElementById('doc-upload')?.click();
                      }}
                    >
                      <div className="attach-item-icon api"><FileCode size={16} /></div>
                      <div className="attach-item-text">
                        <span className="attach-item-title">OpenAPI / Swagger Spec</span>
                        <span className="attach-item-desc">Import .json, .yaml API schema</span>
                      </div>
                    </div>

                    <div 
                      className="attach-menu-item"
                      onClick={() => {
                        setIsAttachMenuOpen(false);
                        const ticket = prompt('Enter Jira Ticket ID (e.g. AUTH-204, CHECKOUT-102):');
                        if (ticket && ticket.trim()) {
                          setInput(ticket.trim());
                        }
                      }}
                    >
                      <div className="attach-item-icon jira"><Sparkles size={16} /></div>
                      <div className="attach-item-text">
                        <span className="attach-item-title">Fetch Jira Ticket</span>
                        <span className="attach-item-desc">Enter ticket key to pull acceptance criteria</span>
                      </div>
                    </div>

                    {(() => {
                      const curSample = SAMPLE_SCENARIOS[sampleIndex % SAMPLE_SCENARIOS.length];
                      return (
                        <div 
                          className="attach-menu-item"
                          onClick={() => {
                            setIsAttachMenuOpen(false);
                            setInput(curSample.prompt);
                            setSelectedFramework(curSample.framework);
                            setSelectedLanguage(curSample.language);
                            setTemplate(curSample.template);
                            setSampleIndex(prev => prev + 1);
                          }}
                          title={`Click to load: ${curSample.title} (Changes every click: #${sampleIndex % SAMPLE_SCENARIOS.length + 1}/${SAMPLE_SCENARIOS.length})`}
                        >
                          <div className="attach-item-icon sample"><Sparkles size={16} /></div>
                          <div className="attach-item-text">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="attach-item-title">Load Sample: {curSample.title}</span>
                              <span style={{ fontSize: 9.5, background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                                #{sampleIndex % SAMPLE_SCENARIOS.length + 1} ↻
                              </span>
                            </div>
                            <span className="attach-item-desc">{curSample.desc}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
              
              <textarea
                ref={textareaRef}
                id="main-input"
                rows={1}
                className="main-text-input"
                placeholder={
                  docMeta 
                    ? 'Optionally add a Jira ID or extra requirement instructions... (Shift+Enter for newline)' 
                    : template === 'No Selection (QA Query / Chat)'
                      ? 'Ask any QA query, explain code, analyze errors, or test strategy... (Shift+Enter for newline)'
                      : 'Describe requirements or enter Jira ID (e.g. "Amazon login automation")... (Shift+Enter for newline)'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isLoading && (input.trim() || docMeta)) {
                      handleGenerate();
                    }
                  }
                }}
                disabled={isLoading}
                autoComplete="off"
              />

              {/* Submit / Execute Button */}
              <div className="send-execute-wrapper">
                <button
                  id="generate-btn"
                  className="btn-send-execute"
                  onClick={() => handleGenerate()}
                  disabled={isLoading || (!input.trim() && !docMeta)}
                  title="Execute generation (Enter)"
                >
                  {isLoading ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
                </button>
              </div>
            </div>

            {/* Caption & Status Line (matching screenshot) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <div className="bottom-status-line">
                <span>
                  model: <strong 
                    style={{ 
                      color: isLlmConnected ? '#38bdf8' : '#8b949e',
                      cursor: 'pointer'
                    }}
                    onClick={() => setIsSettingsOpen(true)}
                    title={isLlmConnected ? `Active model: ${activeModelDisplay}` : "No LLM connected. Click to configure settings."}
                  >
                    {activeModelDisplay}
                  </strong>
                </span>
                <span>·</span>
                <span>schema: <strong className="status-valid">valid</strong></span>
                <span>·</span>
                <span>RAG pipeline: <strong style={{ color: isLlmConnected ? '#10b981' : '#8b949e' }}>{isLlmConnected ? 'connected' : 'standby'}</strong></span>
              </div>
              <span className="execute-subtext">↵ to execute</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Modals ─── */}
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
      
      {isRagModalOpen && (
        <RagWorkflowModal 
          onClose={() => setIsRagModalOpen(false)} 
          onApplyContext={(ctx) => setInput(ctx)}
        />
      )}

      {/* Code Viewer / Playwright Export Modal */}
      {isCodeModalOpen && codeModalData && (
        <div className="rag-modal-overlay" onClick={() => setIsCodeModalOpen(false)}>
          <div className="rag-modal" style={{ width: 880, height: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="rag-modal-header">
              <div className="rag-header-left">
                <div className="rag-badge-icon" style={{ background: '#007acc' }}>
                  <Code2 size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, margin: 0 }}>Automation Test Suite ({codeModalData.fileName})</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Automated Browser E2E Spec Scaffold</p>
                </div>
              </div>
              <button className="rag-close-btn" onClick={() => setIsCodeModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Language Switcher Bar inside modal */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-2)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', marginRight: 4 }}>
                    Language:
                  </span>
                  {[
                    { id: 'typescript', label: 'TypeScript', ext: '.spec.ts' },
                    { id: 'javascript', label: 'JavaScript', ext: '.spec.js' },
                    { id: 'python', label: 'Python (pytest)', ext: '.py' },
                    { id: 'java', label: 'Java (JUnit 5)', ext: '.java' },
                    { id: 'csharp', label: 'C# (NUnit)', ext: '.cs' },
                  ].map((l) => {
                    const isSelected = (codeModalData.language || playwrightLang) === l.id;
                    return (
                      <button
                        key={l.id}
                        onClick={() => {
                          setPlaywrightLang(l.id);
                          switchModalLanguage(l.id);
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          background: isSelected ? '#007acc' : 'var(--bg-3)',
                          color: isSelected ? '#fff' : 'var(--text-2)',
                          border: isSelected ? '1px solid #38bdf8' : '1px solid var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                        title={`Generate test suite in ${l.label}`}
                      >
                        <span>{l.label}</span>
                        <span style={{ opacity: 0.6, fontSize: 10 }}>{l.ext}</span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                  Target: <strong style={{ color: '#38bdf8' }}>{codeModalData.fileName}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(codeModalData.specCode);
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                  className="toolbar-btn"
                  style={{ background: 'var(--bg-3)' }}
                >
                  {codeCopied ? <ClipboardCheck size={14} color="var(--green)" /> : <Copy size={14} />}
                  <span>{codeCopied ? 'Copied Code!' : 'Copy Code'}</span>
                </button>

                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([codeModalData.specCode], { type: 'text/plain' }));
                    a.download = codeModalData.fileName;
                    a.click();
                  }}
                  className="toolbar-btn"
                  style={{ background: 'var(--bg-3)' }}
                >
                  <Download size={14} />
                  <span>Download File</span>
                </button>

                <button
                  onClick={() => handleLaunchInVsCode(codeModalData)}
                  className="vscode-playwright-btn"
                  style={{ marginLeft: 'auto', cursor: 'pointer' }}
                  title="Launch file directly in VS Code desktop application"
                >
                  <ExternalLink size={14} />
                  <span>Open in VS Code</span>
                </button>
              </div>

              <pre 
                style={{
                  flex: 1,
                  background: '#090d16',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 16,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 12,
                  color: '#93c5fd',
                  overflowY: 'auto',
                  margin: 0,
                  minHeight: 260
                }}
              >
                {codeModalData.specCode || getScaffoldBundle('playwright', codeModalData.language || 'typescript', codeModalData.suiteName || '', codeModalData.jiraId).specCode}
              </pre>

              <div style={{ fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-2)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>Run locally in your terminal:</strong>
                  <span style={{ fontSize: 11, color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                    {(codeModalData.language || playwrightLang).toUpperCase()}
                  </span>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-1)', background: '#090d16', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                  {codeModalData.instructions && codeModalData.instructions[1]
                    ? codeModalData.instructions[1].replace(/^\d+\.\s*(Run with:\s*)?/, '')
                    : ((codeModalData.language || playwrightLang) === 'python' ? `pytest tests/${codeModalData.fileName} --headed -v` : (codeModalData.language || playwrightLang) === 'java' ? `mvn test` : (codeModalData.language || playwrightLang) === 'csharp' ? `dotnet test` : `npx playwright test tests/${codeModalData.fileName} --headed`)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Eclipse Import Instructions & Status Modal */}
      {eclipseModalData && (
        <div className="rag-modal-overlay" onClick={() => setEclipseModalData(null)}>
          <div className="rag-modal" style={{ maxWidth: 580, height: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="rag-modal-header">
              <div className="rag-header-left">
                <div className="rag-badge-icon" style={{ background: '#6d28d9' }}>
                  <Coffee size={18} color="#fcd34d" />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, margin: 0 }}>Eclipse IDE Integration</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Maven Selenium Test Suite Prepared</p>
                </div>
              </div>
              <button className="rag-close-btn" onClick={() => setEclipseModalData(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={18} color="#10b981" />
                <span style={{ fontSize: 13, color: '#a7f3d0' }}>
                  Java Selenium test class & Maven <code>pom.xml</code> saved to project disk!
                </span>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>WORKSPACE PATH TO IMPORT INTO ECLIPSE:</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input
                    type="text"
                    readOnly
                    value={eclipseModalData.workspacePath || 'test_code/eclipse'}
                    style={{ flex: 1, padding: '8px 10px', background: '#0d1117', border: '1px solid var(--border-light)', borderRadius: 6, color: '#fff', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(eclipseModalData.workspacePath || 'test_code/eclipse');
                      alert('Copied workspace path to clipboard!');
                    }}
                    className="toolbar-btn"
                    style={{ fontSize: 11, background: 'var(--bg-3)' }}
                  >
                    Copy Path
                  </button>
                </div>
              </div>

              <div style={{ background: '#161b22', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <strong style={{ fontSize: 12, color: '#fff' }}>Quick Eclipse Import Steps:</strong>
                <ol style={{ fontSize: 12, color: 'var(--text-2)', paddingLeft: 18, marginTop: 6, lineHeight: 1.6 }}>
                  <li>Click <strong>Save to Local Disk</strong> below to place files into your local <code>test_code/eclipse</code> directory</li>
                  <li>Launch <strong>Eclipse IDE</strong> on your computer</li>
                  <li>Click <strong>File ➔ Import...</strong></li>
                  <li>Select <strong>Maven ➔ Existing Maven Projects</strong> and click Next</li>
                  <li>Paste the workspace root folder copied above into <strong>Root Directory</strong></li>
                  <li>Click Finish. Right-click the test class ➔ <strong>Run As ➔ TestNG Test</strong>!</li>
                </ol>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <button
                  className="toolbar-btn"
                  style={{ background: '#10b981', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => {
                    saveFilesToLocalFolder([
                      { name: eclipseModalData.fileName, content: eclipseModalData.code || '// Selenium Test Class\n', subfolder: 'src/test/java/com/testforge' },
                      ...(eclipseModalData.pageCode ? [{ name: 'AmazonLoginPage.java', content: eclipseModalData.pageCode, subfolder: 'src/main/java/com/testforge/pages' }] : []),
                      { name: 'pom.xml', content: eclipseModalData.configCode || '<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.testforge</groupId>\n  <artifactId>selenium-tests</artifactId>\n  <version>1.0.0</version>\n</project>' }
                    ]);
                  }}
                  title="Save or download Selenium test suite files to your local folder on any laptop"
                >
                  <Download size={13} />
                  <span>Save to Local Disk</span>
                </button>
                <button className="vscode-playwright-btn" onClick={() => setEclipseModalData(null)}>Got it</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VS Code Import Instructions & Status Modal (Identical UX to Eclipse Modal) */}
      {vsCodeModalData && (
        <div className="rag-modal-overlay" onClick={() => setVsCodeModalData(null)}>
          <div className="rag-modal" style={{ maxWidth: 580, height: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="rag-modal-header">
              <div className="rag-header-left">
                <div className="rag-badge-icon" style={{ background: '#007acc' }}>
                  <Code2 size={18} color="#ffffff" />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, margin: 0 }}>Visual Studio Code Integration</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Playwright Automation Suite Prepared</p>
                </div>
              </div>
              <button className="rag-close-btn" onClick={() => setVsCodeModalData(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={18} color="#10b981" />
                <span style={{ fontSize: 13, color: '#a7f3d0' }}>
                  Playwright test suite & configuration saved to project disk!
                </span>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>WORKSPACE PATH TO OPEN IN VS CODE:</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input
                    type="text"
                    readOnly
                    value={vsCodeModalData.workspacePath}
                    style={{ flex: 1, padding: '8px 10px', background: '#0d1117', border: '1px solid var(--border-light)', borderRadius: 6, color: '#fff', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(vsCodeModalData.workspacePath);
                      alert('Copied workspace path to clipboard!');
                    }}
                    className="toolbar-btn"
                    style={{ fontSize: 11, background: 'var(--bg-3)' }}
                  >
                    Copy Path
                  </button>
                </div>
              </div>

              <div style={{ background: '#161b22', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <strong style={{ fontSize: 12, color: '#fff' }}>Quick VS Code Steps:</strong>
                <ol style={{ fontSize: 12, color: 'var(--text-2)', paddingLeft: 18, marginTop: 6, lineHeight: 1.6 }}>
                  <li>Visual Studio Code has opened on your computer</li>
                  <li>New workspace folder linked in Explorer: <code>{vsCodeModalData.workspacePath.split('/').pop()}</code></li>
                  <li>Active test file opened in editor: <code>{vsCodeModalData.fileName}</code></li>
                  <li>Open integrated terminal (<kbd style={{ background: '#21262d', padding: '1px 5px', borderRadius: 3, border: '1px solid #30363d' }}>Ctrl+`</kbd>) and run: <code>npx playwright test</code></li>
                </ol>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="toolbar-btn"
                    style={{ background: '#10b981', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 5, fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      saveFilesToLocalFolder([
                        { name: vsCodeModalData.fileName, content: vsCodeModalData.specCode || '// Playwright Test Suite\n', subfolder: 'tests' },
                        ...(vsCodeModalData.pageCode ? [{ name: vsCodeModalData.pageFileName || 'AppPage.ts', content: vsCodeModalData.pageCode, subfolder: 'pages' }] : []),
                        ...(vsCodeModalData.configCode ? [{ name: 'playwright.config.ts', content: vsCodeModalData.configCode }] : [])
                      ]);
                    }}
                    title="Save or download Playwright test suite files directly to your local folder on any laptop"
                  >
                    <Download size={13} />
                    <span>Save to Local Disk</span>
                  </button>
                  <button 
                    className="toolbar-btn"
                    style={{ background: '#007acc', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      const uri = vsCodeModalData.vscodeUri || `vscode://file/${vsCodeModalData.filePath.replace(/\\/g, '/')}`;
                      try { window.location.href = uri; } catch {}
                      exportVsCodeApi([], undefined, undefined, undefined, 'playwright', vsCodeModalData.filePath, vsCodeModalData.fileName, true, vsCodeModalData.specCode).catch(() => null);
                    }}
                    title="Launch VS Code desktop application and open this test suite"
                  >
                    <ExternalLink size={13} />
                    <span>Launch in VS Code</span>
                  </button>
                  <button
                    className="toolbar-btn"
                    style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      openFolderApi(vsCodeModalData.workspacePath, vsCodeModalData.filePath);
                    }}
                    title="Open this suite folder in Windows File Explorer"
                  >
                    <Folder size={13} />
                    <span>Open in Explorer</span>
                  </button>
                  <a
                    href={vsCodeModalData.vscodeUri || `vscode://file/${vsCodeModalData.filePath}`}
                    className="toolbar-btn"
                    style={{ background: '#1f2937', color: '#38bdf8', border: '1px solid #38bdf840', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 6 }}
                    title="Direct deep link to open in VS Code on any laptop"
                  >
                    <Code2 size={13} />
                    <span>VS Code Protocol Link</span>
                  </a>
                </div>
                <button className="vscode-playwright-btn" onClick={() => setVsCodeModalData(null)}>Got it</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
