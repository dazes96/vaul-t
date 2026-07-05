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
      req.on('close', () => abort.abort());
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

  /** POST /api/ai/complete — inline autocomplete. Body: { prefix, suffix } */
  r.post('/complete', async (req, res) => {
    const settings = loadSettings();
    if (!settings.autocomplete) return res.json({ completion: '' });
    const { prefix, suffix } = req.body as { prefix: string; suffix: string };
    try {
      const provider = buildProvider(settings);
      const completion = await provider.complete(prefix.slice(-4000), (suffix ?? '').slice(0, 1000));
      res.json({ completion });
    } catch {
      res.json({ completion: '' }); // autocomplete must never surface errors into typing flow
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
