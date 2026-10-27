import React, { useState, useEffect } from 'react';
import { Plus, Search, Trash2, Clock, PanelLeftClose, Pin, PinOff } from 'lucide-react';

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  tag?: string;
  badge?: string;
  badgeColor?: string;
}

interface SidebarProps {
  chatHistory: ChatSession[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onClearAllChats?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

// Default showcase sessions matching the screenshot
export const DEMO_SESSIONS: ChatSession[] = [
  {
    id: 'demo_1',
    title: 'Auth Flow Multi-Tenant',
    tag: '#PROJ-1024',
    badge: '42 tests',
    badgeColor: '#388bfd',
    timestamp: Date.now() - 1000 * 60 * 2, // now
  },
  {
    id: 'demo_2',
    title: 'Payment Gateway Webhook',
    tag: 'PROJ-982',
    badge: 'E2E',
    badgeColor: '#2ea043',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 6, // 05/19
  },
  {
    id: 'demo_3',
    title: 'Generate 100 test cases API',
    tag: 'Microservices',
    badge: 'REST',
    badgeColor: '#d29922',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 24, // 05/01
  },
  {
    id: 'demo_4',
    title: 'Security Boundary Matrix',
    tag: 'PROJ-844',
    badge: 'SecOps',
    badgeColor: '#f85149',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 31, // 04/24
  },
  {
    id: 'demo_5',
    title: 'Playwright Regression Spec',
    tag: 'Cart & Order',
    badge: 'E2E',
    badgeColor: '#388bfd',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 37, // 04/18
  },
];

const Sidebar: React.FC<SidebarProps> = ({ 
  chatHistory, 
  activeChatId, 
  onNewChat, 
  onSelectChat, 
  onDeleteChat,
  onClearAllChats,
  isCollapsed: externalCollapsed,
  onToggleCollapse
}) => {
  const [filterText, setFilterText] = useState('');
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(true);

  const isCollapsed = externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;

  // Keyboard shortcut Ctrl+B / Cmd+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        handleToggleCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCollapsed, onToggleCollapse]);

  const handleToggleCollapse = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  };

  const handleTogglePin = () => {
    setIsPinned((prev) => !prev);
    if (!isPinned && isCollapsed) {
      handleToggleCollapse();
    }
  };

  // Display real user sessions directly from chatHistory
  const displaySessions = chatHistory;

  const filteredSessions = displaySessions.filter((s) => 
    s.title.toLowerCase().includes(filterText.toLowerCase()) ||
    (s.tag && s.tag.toLowerCase().includes(filterText.toLowerCase()))
  );

  const formatTimestamp = (ts: number, id: string) => {
    if (id === 'demo_1') return 'now';
    if (id === 'demo_2') return '05/19';
    if (id === 'demo_3') return '05/01';
    if (id === 'demo_4') return '04/24';
    if (id === 'demo_5') return '04/18';

    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60000 * 5) return 'now';
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  };

  // When collapsed and NOT hovered, render compact interactive strip
  const showFullSidebar = !isCollapsed || isHovered;

  return (
    <div 
      className={`sidebar-wrapper ${isCollapsed ? 'is-collapsed' : ''} ${isHovered ? 'is-hover-expanded' : ''}`}
      onMouseEnter={() => {
        if (isCollapsed) setIsHovered(true);
      }}
      onMouseLeave={() => {
        if (isCollapsed) setIsHovered(false);
      }}
      style={{ position: 'relative', height: '100%', zIndex: isHovered ? 150 : 10 }}
    >
      {/* ─── Compact Rail (Shown when Collapsed & not hovered) ─── */}
      {isCollapsed && !isHovered && (
        <aside className="app-sidebar-compact" title="Click or hover to expand recent sessions">
          <button 
            className="compact-rail-btn new-chat-btn-compact"
            onClick={onNewChat}
            title="New Test Session"
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>

          <button 
            className="compact-rail-btn search-btn-compact"
            onClick={handleToggleCollapse}
            title="Open Sessions (Ctrl+B)"
          >
            <Search size={15} />
          </button>

          <div className="compact-rail-divider" />

          {/* Quick sessions dots */}
          <div className="compact-sessions-stack" title={`${filteredSessions.length} Recent Sessions`}>
            {filteredSessions.slice(0, 6).map((s) => (
              <div
                key={s.id}
                className={`compact-session-dot ${s.id === activeChatId ? 'active' : ''}`}
                style={{ background: s.badgeColor || '#388bfd' }}
                onClick={() => onSelectChat(s.id)}
                title={`${s.title} (${s.tag || ''})`}
              />
            ))}
          </div>
        </aside>
      )}

      {/* ─── Full Expanded Sidebar (Normal OR Hovered-out Drawer) ─── */}
      {showFullSidebar && (
        <aside className={`app-sidebar ${isHovered && isCollapsed ? 'app-sidebar-peek-drawer' : ''}`}>
          {/* Header Controls: Collapse button + Pin */}
          <div className="sidebar-top-controls">
            <div className="sidebar-brand-mini">
              <span className="sidebar-brand-dot" />
              <span>TEST SESSIONS</span>
            </div>
            <div className="sidebar-control-actions">
              <button
                className={`sidebar-ctrl-btn ${isPinned ? 'active' : ''}`}
                onClick={handleTogglePin}
                title={isPinned ? 'Sidebar Pinned (Click to unpin)' : 'Pin Sidebar Open'}
              >
                {isPinned ? <Pin size={13} /> : <PinOff size={13} />}
              </button>
              <button
                className="sidebar-ctrl-btn"
                onClick={handleToggleCollapse}
                title="Hide / Collapse Sidebar (Ctrl+B)"
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>

          {/* New Test Session Button */}
          <button 
            id="new-session-btn" 
            className="btn-new-session" 
            onClick={onNewChat}
            title="Start a new test generation session"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>New Test Session</span>
          </button>

          {/* Filter / Search Input */}
          <div className="sidebar-search-box">
            <Search size={14} className="search-icon" />
            <input 
              type="text" 
              placeholder="Filter sessions..." 
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              autoFocus={isHovered && isCollapsed}
            />
            {filterText && (
              <button className="clear-search" onClick={() => setFilterText('')}>✕</button>
            )}
          </div>

          {/* Header Row: Recent Sessions + Clear */}
          <div className="sidebar-section-header">
            <span className="section-title">
              <Clock size={12} style={{ display: 'inline', marginRight: 5, verticalAlign: -1 }} />
              RECENT SESSIONS
            </span>
            {onClearAllChats && chatHistory.length > 0 && (
              <button 
                type="button" 
                className="clear-all-btn" 
                onClick={(e) => {
                  e.stopPropagation();
                  onClearAllChats();
                }}
                title="Clear all session history"
              >
                clear
              </button>
            )}
          </div>

      {/* Sessions List */}
      <div className="sidebar-session-list">
        {filteredSessions.length === 0 ? (
          <div className="empty-sessions-state">
            <Clock size={18} className="empty-sessions-icon" />
            <span className="empty-sessions-text">
              {filterText ? 'No matching sessions' : 'No recent sessions'}
            </span>
            <span className="empty-sessions-sub">
              {filterText ? 'Try a different filter' : 'History cleared'}
            </span>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeChatId;
            const badgeText = session.badge || (session.id === 'demo_1' ? '42 tests' : 'E2E');
            const tagText = session.tag || '#PROJ-1024';

            return (
              <div
                key={session.id}
                className={`session-card ${isActive ? 'active' : ''}`}
                onClick={() => onSelectChat(session.id)}
              >
                <div className="session-card-top">
                  <span className="session-card-title" title={session.title}>
                    {session.title}
                  </span>
                  <span className="session-badge" style={{ color: session.badgeColor || '#79c0ff' }}>
                    {badgeText}
                  </span>
                </div>
                <div className="session-card-bottom">
                  <span className="session-tag">{tagText}</span>
                  <span className="session-time">{formatTimestamp(session.timestamp, session.id)}</span>
                  <button 
                    className="session-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(session.id);
                    }}
                    title="Delete session"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer: Clean workspace status indicator */}
      <div className="sidebar-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2ea043', boxShadow: '0 0 6px #2ea043' }} />
          <span>Local Engine Active</span>
        </div>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>v3.4-pro</span>
      </div>
    </aside>
  )}
</div>
);
};

export default Sidebar;
