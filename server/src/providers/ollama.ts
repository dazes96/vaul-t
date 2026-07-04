import type { ChatMessage, ChatOptions, Provider } from './types.js';

/** Native Ollama API (http://localhost:11434). Streams NDJSON. */
export function ollamaProvider(baseUrl: string, model: string): Provider {
  return {
    async *streamChat(messages: ChatMessage[], opts: ChatOptions = {}) {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? -1 },
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Ollama: ${res.status} ${await res.text()}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          if (j.message?.content) yield j.message.content as string;
        }
      }
    },

    async complete(prefix, suffix, opts = {}) {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          model, prompt: prefix, suffix, stream: false,
          options: { temperature: 0.1, num_predict: opts.maxTokens ?? 128 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama: ${res.status}`);
      const j = await res.json();
      return (j.response as string) ?? '';
    },

    async listModels() {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) return [];
      const j = await res.json();
      return (j.models ?? []).map((m: { name: string }) => m.name);
    },
  };
}
