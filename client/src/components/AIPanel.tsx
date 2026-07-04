import { useEffect, useMemo, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { apiGet, apiPost, apiDelete, streamChat, type ChatMessage } from '../api';
import { useStore } from '../state/store';
import { languageForPath } from '../monacoSetup';

type Mode = 'chat' | 'agent' | 'explain' | 'review' | 'docs';

interface DisplayMsg {
  role: 'user' | 'assistant' | 'event';
  content: string;
}

interface Approval {
  id: string;
  action: { tool: string; path?: string; command?: string; [k: string]: unknown };
  preview?: { oldContent: string | null; newContent: string };
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false })), [text]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function AIPanel() {
  const [mode, setMode] = useState<Mode>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const workspace = useStore(s => s.workspace);
  const settings = useStore(s => s.settings);
  const refreshTree = useStore(s => s.refreshTree);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, approval]);

  useEffect(() => {
    if (workspace) void loadConversationList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  async function loadConversationList() {
    setConversations(await apiGet(`/api/conversations?workspace=${encodeURIComponent(workspace)}`));
  }

  async function persist(msgs: DisplayMsg[]) {
    const chatMsgs = msgs.filter(m => m.role !== 'event');
    if (!chatMsgs.length) return;
    const title = chatMsgs[0].content.slice(0, 60);
    const res = await apiPost<{ id: string }>('/api/conversations', {
      id: convId ?? undefined, title, workspace, messages: chatMsgs,
    });
    if (!convId) { setConvId(res.id); void loadConversationList(); }
  }

  async function openConversation(id: string) {
    const conv = await apiGet<{ id: string; messages: DisplayMsg[] }>(`/api/conversations/${id}`);
    setConvId(conv.id);
    setMessages(conv.messages);
  }

  function newConversation() {
    setConvId(null);
    setMessages([]);
  }

  const history = (): ChatMessage[] =>
    messages.filter(m => m.role !== 'event').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  async function send() {
    const task = input.trim();
    if (!task || busy) return;
    setInput('');
    setBusy(true);
    const base: DisplayMsg[] = [...messages, { role: 'user', content: task }];
    setMessages(base);

    try {
      if (mode === 'agent') await runAgent(task, base);
      else await runChat(task, base);
    } catch (err) {
      setMessages(m => [...m, { role: 'event', content: `⚠ ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function runChat(task: string, base: DisplayMsg[]) {
    abortRef.current = new AbortController();
    let acc = '';
    setMessages([...base, { role: 'assistant', content: '' }]);
    const chatMessages: ChatMessage[] = base
      .filter(m => m.role !== 'event')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    await streamChat(
      { messages: chatMessages, mode },
      (delta) => {
        acc += delta;
        setMessages([...base, { role: 'assistant', content: acc }]);
      },
      abortRef.current.signal,
    );
    void persist([...base, { role: 'assistant', content: acc }]);
  }

  function runAgent(task: string, base: DisplayMsg[]): Promise<void> {
    return new Promise((resolve) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/agent`);
      wsRef.current = ws;
      let current: DisplayMsg[] = [...base];
      let streaming = '';

      const flush = () => setMessages([...current, ...(streaming ? [{ role: 'assistant' as const, content: streaming }] : [])]);

      ws.onopen = () => ws.send(JSON.stringify({ type: 'start', task, history: history() }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'text':
            streaming += msg.delta;
            flush();
            break;
          case 'action': {
            if (streaming) { current = [...current, { role: 'assistant', content: streaming }]; streaming = ''; }
            const a = msg.action;
            current = [...current, { role: 'event', content: `▸ ${a.tool} ${a.path ?? a.command ?? a.query ?? ''}` }];
            flush();
            break;
          }
          case 'approval-request':
            setApproval({ id: msg.id, action: msg.action, preview: msg.preview });
            break;
          case 'tool-result':
            current = [...current, { role: 'event', content: `${msg.ok ? '✓' : '✗'} ${msg.tool}${msg.ok ? '' : `: ${String(msg.output).slice(0, 200)}`}` }];
            if (msg.tool === 'write_file' || msg.tool === 'delete_file') refreshTree();
            flush();
            break;
          case 'error':
            current = [...current, { role: 'event', content: `⚠ ${msg.message}` }];
            flush();
            break;
          case 'done':
            if (streaming) current = [...current, { role: 'assistant', content: streaming }];
            setMessages(current);
            void persist(current);
            ws.close();
            resolve();
            break;
        }
      };
      ws.onerror = () => {
        current = [...current, { role: 'event', content: '⚠ Agent connection failed' }];
        setMessages(current);
        resolve();
      };
    });
  }

  function answerApproval(approved: boolean) {
    if (approval && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'approve', id: approval.id, approved }));
    }
    setApproval(null);
  }

  function stop() {
    abortRef.current?.abort();
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'cancel' }));
    setApproval(null);
    setBusy(false);
  }

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <b style={{ color: 'var(--accent)' }}>✦ AI</b>
        <select value={mode} onChange={e => setMode(e.target.value as Mode)} title="Assistant mode">
          <option value="chat">Chat</option>
          <option value="agent">Agent</option>
          <option value="explain">Explain</option>
          <option value="review">Review</option>
          <option value="docs">Docs</option>
        </select>
        <select
          value={convId ?? ''}
          onChange={e => (e.target.value ? void openConversation(e.target.value) : newConversation())}
          title="Conversation history"
          style={{ maxWidth: 120 }}
        >
          <option value="">New chat</option>
          {conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        {convId && (
          <button title="Delete conversation" onClick={() => { void apiDelete(`/api/conversations/${convId}`); newConversation(); void loadConversationList(); }}>🗑</button>
        )}
        {settings?.beginnerMode && <span className="badge">beginner</span>}
      </div>

      <div className="ai-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--fg-dim)', fontSize: 12.5, lineHeight: 1.6 }}>
            <b>Chat</b> — ask about your code; relevant files are included automatically.<br />
            <b>Agent</b> — give a task; the AI plans, edits files, and runs commands with your approval.<br />
            <b>Explain / Review / Docs</b> — focused modes for understanding, reviewing, and documenting.
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'event'
            ? <div key={i} className="msg event">{m.content}</div>
            : <div key={i} className={`msg ${m.role}`}><Markdown text={m.content} /></div>,
        )}
        {busy && !approval && <div className="msg event">…thinking</div>}
      </div>

      {approval && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              Agent wants to: <code>{approval.action.tool}</code>
              <span style={{ fontWeight: 400, color: 'var(--fg-dim)' }}>{approval.action.path ?? approval.action.command}</span>
            </header>
            <div className="modal-body">
              {approval.preview ? (
                <div className="approval-diff">
                  <DiffEditor
                    height="100%"
                    original={approval.preview.oldContent ?? ''}
                    modified={approval.preview.newContent}
                    language={languageForPath(String(approval.action.path ?? ''))}
                    theme={settings?.theme === 'light' ? 'light' : 'vs-dark'}
                    options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false } }}
                  />
                </div>
              ) : (
                <pre className="output-log">{JSON.stringify(approval.action, null, 2)}</pre>
              )}
            </div>
            <footer>
              <button onClick={() => answerApproval(false)}>Reject</button>
              <button className="primary" onClick={() => answerApproval(true)}>
                {approval.action.tool === 'write_file' ? 'Apply change' : 'Allow'}
              </button>
            </footer>
          </div>
        </div>
      )}

      <div className="ai-input">
        <textarea
          placeholder={mode === 'agent' ? 'Describe a task for the agent… (Enter to run)' : 'Ask about your code… (Enter to send)'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
        />
        {busy
          ? <button className="danger" onClick={stop}>Stop</button>
          : <button className="primary" onClick={() => void send()}>Send</button>}
      </div>
    </div>
  );
}
