import { Router } from 'express';
import { loadSettings } from '../config.js';
import { buildProvider } from '../providers/registry.js';
import type { ChatMessage } from '../providers/types.js';
import { getIndex } from './indexRoute.js';
import { selectContext } from '../intelligence/retrieval.js';
import { loadMemory, memoryContext } from '../memory/memory.js';

function chatSystemPrompt(projectMap: string, beginnerMode: boolean, mode: string): string {
  const base = `You are the AI assistant inside Emerald Code Studio, a local open-source IDE. You have been given a map of the user's project and the most relevant files. Answer precisely and reference files by their relative paths.`;
  const modes: Record<string, string> = {
    chat: '',
    explain: '\nMODE: Explain code. Walk through what the code does in clear language a beginner can follow. Explain the purpose before the mechanics.',
    review: '\nMODE: Code review. Look for bugs, security issues, performance problems, and unclear code. Be specific: quote the line, explain the problem, suggest the fix. Rank findings by severity.',
    docs: '\nMODE: Documentation. Generate clear documentation (docstrings, README sections, usage examples) for the code under discussion.',
  };
  const beginner = beginnerMode
    ? '\nBEGINNER MODE IS ON: the user is not a programmer. Never assume programming knowledge. Explain plainly, define technical terms, describe which files are involved and why they matter, and recommend best practices gently.'
    : '';
  return base + (modes[mode] ?? '') + beginner + `\n\nProject map:\n${projectMap}`;
}

export function aiRoutes(getWorkspace: () => string): Router {
  const r = Router();

  /**
   * POST /api/ai/chat — streams the reply as SSE.
   * Body: { messages, mode?, includeContext?, contextQuery?, providerId? }
   */
  r.post('/chat', async (req, res) => {
    // The whole handler is guarded: a failure while BUILDING the request (bad
    // provider config, index not ready, context read error) must return a clean
    // error, never crash the server. Express 4 does not catch rejected promises
    // from async handlers, so an unguarded throw here would take the whole
    // process down.
    try {
      const { messages, mode = 'chat', includeContext = true, providerId } = req.body as {
        messages: ChatMessage[]; mode?: string; includeContext?: boolean; providerId?: string;
      };
      const settings = loadSettings();
      const provider = buildProvider(settings, providerId);
      const index = await getIndex(getWorkspace());

      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const memBlock = memoryContext(loadMemory(getWorkspace()), lastUser?.content ?? '');
      const system: ChatMessage = {
        role: 'system',
        content: chatSystemPrompt(index.map, settings.beginnerMode, mode) + (memBlock ? `\n\n${memBlock}` : ''),
      };
      const full: ChatMessage[] = [system];
      if (includeContext && messages.length) {
        const files = await selectContext(index, lastUser?.content ?? '');
        if (files.length) {
          full.push({
            role: 'user',
            content: 'Relevant project files for context (selected by symbol, path, and import-graph relevance):\n\n'
              + files.map(f => `### ${f.path} (${f.reason})\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n'),
          });
          full.push({ role: 'assistant', content: 'I have read the project context. What would you like to do?' });
        }
      }
      full.push(...messages);

      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.flushHeaders();
      const abort = new AbortController();
      // See the note on /edit: res.on('close') gated on writableEnded detects a
      // real client disconnect; req.on('close') would fire on body-read and
      // abort our own stream.
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      for await (const delta of provider.streamChat(full, { signal: abort.signal })) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      res.write('data: {"done":true}\n\n');
      res.end();
    } catch (err) {
      const message = (err as Error).message;
      // If streaming already started, deliver the error in-band; otherwise send
      // a normal JSON error the client surfaces to the user.
      if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: message })}\n\n`); res.end(); }
      else res.status(500).json({ error: message });
    }
  });

  /** POST /api/ai/complete — inline autocomplete. Body: { prefix, suffix, path? } */
  r.post('/complete', async (req, res) => {
    const settings = loadSettings();
    if (!settings.autocomplete) return res.json({ completion: '' });
    const { prefix, suffix, path: filePath } = req.body as { prefix: string; suffix: string; path?: string };
    const abort = new AbortController();
    // Abort the model call only when the client actually disconnects (Monaco
    // cancelled the completion because the user kept typing). res.on('close')
    // gated on writableEnded is the reliable signal; req.on('close') fires on
    // body-read and would kill legitimate completions before they return.
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const provider = buildProvider(settings);
      // Light context: the symbols this file and its imports define, so the
      // model completes with real names in scope instead of guessing. Cheap to
      // build (already in the index) and kept small to protect latency.
      let hint = '';
      if (filePath) {
        try {
          const index = await getIndex(getWorkspace());
          const names = new Set<string>();
          for (const s of index.getFile(filePath)?.symbols ?? []) names.add(s.name);
          for (const dep of index.importsOf(filePath).slice(0, 6)) {
            for (const s of index.getFile(dep)?.symbols.slice(0, 8) ?? []) names.add(s.name);
          }
          if (names.size) hint = `// symbols in scope: ${[...names].slice(0, 40).join(', ')}\n`;
        } catch { /* index not ready — complete without the hint */ }
      }
      const completion = await provider.complete(hint + prefix.slice(-4000), (suffix ?? '').slice(0, 1000), { signal: abort.signal });
      res.json({ completion });
    } catch {
      res.json({ completion: '' }); // autocomplete must never surface errors into typing flow
    }
  });

  /**
   * POST /api/ai/edit — inline code edit (the engine behind Ctrl+K inline chat).
   * Streams ONLY the replacement for the selected code, per the instruction.
   * Body: { path, selection, instruction, language? }
   */
  r.post('/edit', async (req, res) => {
    try {
      const { path: filePath, selection, instruction, language } = req.body as {
        path?: string; selection: string; instruction: string; language?: string;
      };
      const settings = loadSettings();
      const provider = buildProvider(settings);
      const mem = memoryContext(loadMemory(getWorkspace()), instruction);
      const system: ChatMessage = {
        role: 'system',
        content: `You are a precise code-editing engine inside a local IDE. Rewrite the user's SELECTED code to satisfy their instruction. Output ONLY the replacement code — no explanations, no commentary, and no markdown code fences. Preserve the surrounding indentation style and language (${language || 'infer from the code'}). If the instruction asks a question rather than an edit, still return the best edited code.`
          + (mem ? `\n\n${mem}` : ''),
      };
      const user: ChatMessage = {
        role: 'user',
        content: `File: ${filePath ?? '(untitled)'}\nInstruction: ${instruction}\n\nSelected code:\n${selection}`,
      };

      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.flushHeaders();
      const abort = new AbortController();
      // Abort only on a genuine client disconnect. `req.on('close')` is wrong
      // here — it fires when Express finishes READING the request body, which
      // would abort our own stream mid-flight. `res.on('close')` gated on
      // writableEnded fires only when the client actually goes away.
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      let acc = '';
      for await (const delta of provider.streamChat([system, user], { signal: abort.signal, temperature: 0.1 })) {
        acc += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      // Strip stray code fences the model may have added despite instructions.
      const cleaned = acc.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '');
      res.write(`data: ${JSON.stringify({ done: true, full: cleaned })}\n\n`);
      res.end();
    } catch (err) {
      const message = (err as Error).message;
      if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: message })}\n\n`); res.end(); }
      else res.status(500).json({ error: message });
    }
  });

  /** GET /api/ai/models?providerId= — list models on a backend. */
  r.get('/models', async (req, res) => {
    try {
      const provider = buildProvider(loadSettings(), req.query.providerId ? String(req.query.providerId) : undefined);
      res.json({ models: await provider.listModels() });
    } catch (err) {
      res.json({ models: [], error: (err as Error).message });
    }
  });

  /**
   * GET /api/ai/ping?providerId= — explicit, on-demand connectivity check
   * (never polled automatically, so it never generates background traffic
   * or unwanted cost against a paid API). Tries listModels() first, which is
   * free on every built-in provider except Anthropic; for providers with no
   * model-list endpoint, falls back to a 1-token chat call so "Test
   * connection" still means something for them.
   */
  r.get('/ping', async (req, res) => {
    const start = Date.now();
    try {
      const provider = buildProvider(loadSettings(), req.query.providerId ? String(req.query.providerId) : undefined);
      const models = await provider.listModels();
      if (models.length > 0) return res.json({ ok: true, models, ms: Date.now() - start });

      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8000);
      try {
        for await (const _ of provider.streamChat([{ role: 'user', content: 'hi' }], { signal: abort.signal, maxTokens: 1 })) break;
        res.json({ ok: true, models: [], ms: Date.now() - start });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message, ms: Date.now() - start });
    }
  });

  return r;
}
