import React from 'react';
import { Plus, MessageSquare, Clock, Trash2 } from 'lucide-react';

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
}

interface SidebarProps {
  chatHistory: ChatSession[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ chatHistory, activeChatId, onNewChat, onSelectChat, onDeleteChat }) => {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">TC</div>
        <span className="sidebar-logo-text">Test Case<br />Generator</span>
      </div>

      <button id="new-chat-btn" className="new-chat-btn" onClick={onNewChat}>
        <Plus size={16} />
        <span>New Chat</span>
      </button>

      <h2>
        <Clock size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
        Recent
      </h2>

      <div className="history-list">
        {chatHistory.length === 0 ? (
          <div className="history-empty">
            <MessageSquare size={14} style={{ opacity: 0.4 }} />
            <span>No history yet</span>
          </div>
        ) : (
          chatHistory.map((chat) => (
            <div
              key={chat.id}
              className={`history-item ${chat.id === activeChatId ? 'active' : ''}`}
              onClick={() => onSelectChat(chat.id)}
              title={chat.title}
            >
              <div className="history-item-content">
                <MessageSquare size={12} className="history-item-icon" />
                <span className="history-item-title">{chat.title}</span>
              </div>
              <div className="history-item-meta">
                <span className="history-item-time">{formatTime(chat.timestamp)}</span>
                <button
                  className="history-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChat(chat.id);
                  }}
                  title="Delete chat"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Sidebar;
