import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { monaco, languageForPath } from '../monacoSetup';
import { useStore } from '../state/store';
import { apiPost, streamSSE } from '../api';

/**
 * Register the AI inline-completion provider once, globally.
 *
 * Improvements over a naive version: it honours Monaco's cancellation token
 * (aborting the in-flight model request the instant the user types more, so
 * stale completions never fight the keyboard), debounces, and passes the file
 * path so the server can add in-scope symbols as context.
 */
let completionsRegistered = false;
function registerAICompletions() {
  if (completionsRegistered) return;
  completionsRegistered = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
    provideInlineCompletions: (model, position, _context, token) =>
      new Promise((resolve) => {
        if (!useStore.getState().settings?.autocomplete) return resolve({ items: [] });
        if (timer) clearTimeout(timer);
        const controller = new AbortController();
        const onCancel = token.onCancellationRequested(() => { controller.abort(); if (timer) clearTimeout(timer); resolve({ items: [] }); });
        timer = setTimeout(async () => {
          try {
            const prefix = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column));
            const lastLine = model.getLineCount();
            const suffix = model.getValueInRange(
              new monaco.Range(position.lineNumber, position.column, lastLine, model.getLineMaxColumn(lastLine)));
            const path = useStore.getState().activePath ?? undefined;
            const res = await apiPost<{ completion: string }>('/api/ai/complete', { prefix, suffix, path }, controller.signal);
            const text = res.completion.trimEnd();
            resolve(text ? { items: [{ insertText: text }] } : { items: [] });
          } catch {
            resolve({ items: [] });
          } finally {
            onCancel.dispose();
          }
        }, 400);
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

interface InlineEdit {
  phase: 'input' | 'streaming' | 'review';
  instruction: string;
  original: string;
  proposed: string;
  range: import('monaco-editor').IRange;
}

export function EditorArea() {
  const tabs = useStore(s => s.tabs);
  const activePath = useStore(s => s.activePath);
  const setContent = useStore(s => s.setContent);
  const settings = useStore(s => s.settings);
  const flash = useStore(s => s.flash);
  const tab = tabs.find(t => t.path === activePath);
  const [view, setView] = useState<'code' | 'preview'>('code');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const inlineAbort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(registerAICompletions, []);
  useEffect(() => setView('code'), [activePath]);
  useEffect(() => { if (inline?.phase === 'input') inputRef.current?.focus(); }, [inline?.phase]);

  // --- Inline edit (Ctrl+K) --------------------------------------------------
  const openInline = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    let sel = editor.getSelection();
    if (!sel || sel.isEmpty()) {
      const line = sel ? sel.startLineNumber : model.getPosition()?.lineNumber ?? 1;
      sel = new monaco.Range(line, 1, line, model.getLineMaxColumn(line));
    }
    const original = model.getValueInRange(sel);
    setInline({ phase: 'input', instruction: '', original, proposed: '', range: sel });
  }, []);
  const openInlineRef = useRef(openInline);
  openInlineRef.current = openInline;

  const closeInline = useCallback(() => {
    inlineAbort.current?.abort();
    setInline(null);
    editorRef.current?.focus();
  }, []);

  async function runInlineEdit(instruction: string) {
    if (!inline || !instruction.trim()) return;
    inlineAbort.current = new AbortController();
    setInline({ ...inline, phase: 'streaming', instruction, proposed: '' });
    let acc = '';
    try {
      await streamSSE('/api/ai/edit', {
        path: activePath,
        selection: inline.original,
        instruction,
        language: activePath ? languageForPath(activePath) : undefined,
      }, (evt) => {
        if (evt.error) throw new Error(String(evt.error));
        if (typeof evt.delta === 'string') { acc += evt.delta; setInline(cur => cur ? { ...cur, proposed: acc } : cur); }
        if (typeof evt.full === 'string') acc = evt.full;
      }, inlineAbort.current.signal);
      setInline(cur => cur ? { ...cur, proposed: acc, phase: 'review' } : cur);
    } catch (err) {
      if (!inlineAbort.current?.signal.aborted) flash(`Inline edit failed: ${(err as Error).message}`, 'error');
      setInline(null);
    }
  }

  function acceptInline() {
    const editor = editorRef.current;
    if (editor && inline) {
      editor.executeEdits('emerald-inline', [{ range: inline.range, text: inline.proposed }]);
      editor.pushUndoStop();
      flash('Applied AI edit — review and save (Ctrl+S)');
    }
    closeInline();
  }

  if (!tab) {
    return (
      <div className="editor-area">
        <div className="empty-editor">
          <div className="logo">💎</div>
          <div><b>Emerald Code Studio</b></div>
          <div>Open a file from the Explorer, or press <kbd>Ctrl+P</kbd> to jump to a file.</div>
          <div>Ask the AI anything with <kbd>Ctrl+L</kbd>, or edit code inline with <kbd>Ctrl+K</kbd>.</div>
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

      {inline && (
        <div className="inline-edit">
          <div className="inline-edit-bar">
            <span className="badge">Ctrl+K</span>
            <input
              ref={inputRef}
              placeholder="Describe the edit (e.g. add error handling, convert to async/await)…"
              value={inline.instruction}
              disabled={inline.phase === 'streaming'}
              onChange={e => setInline({ ...inline, instruction: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter' && inline.phase === 'input') { e.preventDefault(); void runInlineEdit(inline.instruction); }
                else if (e.key === 'Escape') { e.preventDefault(); closeInline(); }
              }}
            />
            {inline.phase === 'input' && <button className="primary" onClick={() => void runInlineEdit(inline.instruction)}>Generate</button>}
            {inline.phase === 'streaming' && <button className="danger" onClick={closeInline}>Stop</button>}
            {inline.phase === 'review' && (
              <>
                <button className="primary" onClick={acceptInline}>Accept</button>
                <button onClick={() => setInline({ ...inline, phase: 'input', proposed: '' })}>Retry</button>
                <button onClick={closeInline}>Reject</button>
              </>
            )}
            <button title="Close" onClick={closeInline}>×</button>
          </div>
          {(inline.phase === 'streaming' || inline.phase === 'review') && (
            <div className="inline-edit-diff">
              <DiffEditor
                height="100%"
                original={inline.original}
                modified={inline.proposed || ' '}
                language={activePath ? languageForPath(activePath) : 'plaintext'}
                theme={settings?.theme === 'light' ? 'light' : 'vs-dark'}
                options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12.5 }}
              />
            </div>
          )}
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
          onMount={(editor) => {
            editorRef.current = editor;
            editor.addAction({
              id: 'emerald.inlineEdit',
              label: 'Emerald: Edit selection with AI',
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
              run: () => openInlineRef.current(),
            });
          }}
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
