import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { monaco, languageForPath } from '../monacoSetup';
import { useStore } from '../state/store';
import { apiPost } from '../api';

/** Register the AI inline-completion provider once, globally. */
let completionsRegistered = false;
function registerAICompletions() {
  if (completionsRegistered) return;
  completionsRegistered = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
    provideInlineCompletions: (model, position) =>
      new Promise((resolve) => {
        if (!useStore.getState().settings?.autocomplete) return resolve({ items: [] });
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            const prefix = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column));
            const lastLine = model.getLineCount();
            const suffix = model.getValueInRange(
              new monaco.Range(position.lineNumber, position.column, lastLine, model.getLineMaxColumn(lastLine)));
            const res = await apiPost<{ completion: string }>('/api/ai/complete', { prefix, suffix });
            const text = res.completion.trimEnd();
            resolve(text ? { items: [{ insertText: text }] } : { items: [] });
          } catch {
            resolve({ items: [] });
          }
        }, 450);
      }),
    freeInlineCompletions: () => { /* nothing to release */ },
  });
}

function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(content, { async: false })), [content]);
  return <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

function JsonViewer({ content }: { content: string }) {
  const pretty = useMemo(() => {
    try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return null; }
  }, [content]);
  return <pre className="output-log" style={{ height: '100%', overflow: 'auto', margin: 0 }}>{pretty ?? content}</pre>;
}

export function EditorArea() {
  const tabs = useStore(s => s.tabs);
  const activePath = useStore(s => s.activePath);
  const setContent = useStore(s => s.setContent);
  const settings = useStore(s => s.settings);
  const tab = tabs.find(t => t.path === activePath);
  const [view, setView] = useState<'code' | 'preview'>('code');
  const editorRef = useRef<unknown>(null);

  useEffect(registerAICompletions, []);
  useEffect(() => setView('code'), [activePath]);

  if (!tab) {
    return (
      <div className="editor-area">
        <div className="empty-editor">
          <div className="logo">💎</div>
          <div><b>Emerald Code Studio</b></div>
          <div>Open a file from the Explorer, or press <kbd>Ctrl+P</kbd> to jump to a file.</div>
          <div>Ask the AI anything with <kbd>Ctrl+L</kbd>.</div>
        </div>
      </div>
    );
  }

  if (tab.kind === 'image') {
    const mime = tab.path.endsWith('.svg') ? 'image/svg+xml' : `image/${tab.path.split('.').pop()}`;
    return (
      <div className="editor-area">
        <div className="image-viewer">
          <img src={`data:${mime};base64,${tab.base64}`} alt={tab.path} />
        </div>
      </div>
    );
  }

  const isMarkdown = tab.path.endsWith('.md');
  const isJson = tab.path.endsWith('.json');
  const showPreviewToggle = isMarkdown || isJson;

  return (
    <div className="editor-area">
      {showPreviewToggle && (
        <div style={{ position: 'absolute', top: 6, right: 16, zIndex: 10 }}>
          <button onClick={() => setView(v => (v === 'code' ? 'preview' : 'code'))}>
            {view === 'code' ? (isMarkdown ? '👁 Preview' : '👁 Formatted') : '✎ Source'}
          </button>
        </div>
      )}
      {view === 'preview' && isMarkdown ? (
        <MarkdownPreview content={tab.content} />
      ) : view === 'preview' && isJson ? (
        <JsonViewer content={tab.content} />
      ) : (
        <Editor
          height="100%"
          path={tab.path}
          language={languageForPath(tab.path)}
          value={tab.content}
          theme={settings?.theme === 'light' ? 'light' : 'vs-dark'}
          onChange={(v) => setContent(tab.path, v ?? '')}
          onMount={(editor) => { editorRef.current = editor; }}
          options={{
            fontSize: 13.5,
            minimap: { enabled: true },
            inlineSuggest: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
          }}
        />
      )}
    </div>
  );
}
