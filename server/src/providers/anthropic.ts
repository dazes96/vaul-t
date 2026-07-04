import { sseLines, type ChatMessage, type ChatOptions, type Provider } from './types.js';

/** Anthropic Messages API (optional — the app never requires a paid API). */
export function anthropicProvider(baseUrl: string, model: string, apiKey?: string): Provider {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  return {
    async *streamChat(messages: ChatMessage[], opts: ChatOptions = {}) {
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const rest = messages.filter(m => m.role !== 'system');
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        signal: opts.signal,
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.2,
          ...(system ? { system } : {}),
          messages: rest,
          stream: true,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Anthropic: ${res.status} ${await res.text()}`);
      for await (const data of sseLines(res.body)) {
        try {
          const j = JSON.parse(data);
          if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text as string;
        } catch { /* event lines without JSON payloads */ }
      }
    },

    async complete(prefix, suffix, opts = {}) {
      let out = '';
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a code completion engine. Output ONLY the code to insert at the cursor.' },
        { role: 'user', content: `<before>\n${prefix}\n</before>\n<after>\n${suffix}\n</after>` },
      ];
      for await (const d of this.streamChat(messages, { ...opts, maxTokens: 128 })) out += d;
      return out;
    },

    async listModels() {
      return []; // Anthropic has no public list endpoint compatible everywhere; user types the model id.
    },
  };
}
