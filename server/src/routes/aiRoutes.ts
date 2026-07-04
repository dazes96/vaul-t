import { Router } from 'express';
import { loadSettings } from '../config.js';
import { buildProvider } from '../providers/registry.js';
import type { ChatMessage } from '../providers/types.js';
import { getIndex, } from './indexRoute.js';
import { selectContextFiles } from '../intelligence/indexer.js';

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
    const { messages, mode = 'chat', includeContext = true, providerId } = req.body as {
      messages: ChatMessage[]; mode?: string; includeContext?: boolean; providerId?: string;
    };
    const settings = loadSettings();
    const provider = buildProvider(settings, providerId);
    const index = getIndex(getWorkspace());

    const system: ChatMessage = { role: 'system', content: chatSystemPrompt(index.map, settings.beginnerMode, mode) };
    const full: ChatMessage[] = [system];
    if (includeContext && messages.length) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const files = selectContextFiles(index, lastUser?.content ?? '');
      if (files.length) {
        full.push({
          role: 'user',
          content: 'Relevant project files for context:\n\n' + files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n'),
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
    try {
      for await (const delta of provider.streamChat(full, { signal: abort.signal })) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      res.write('data: {"done":true}\n\n');
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
    }
    res.end();
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

  return r;
}
