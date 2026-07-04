import type { ChatMessage, ChatOptions, Provider } from './types.js';

/** Google Gemini generateContent API (optional). */
export function geminiProvider(baseUrl: string, model: string, apiKey?: string): Provider {
  return {
    async *streamChat(messages: ChatMessage[], opts: ChatOptions = {}) {
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey ?? ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens ?? 8192 },
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Gemini: ${res.status} ${await res.text()}`);
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
          if (!line.startsWith('data:')) continue;
          try {
            const j = JSON.parse(line.slice(5));
            const text = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
            if (text) yield text as string;
          } catch { /* skip */ }
        }
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
      try {
        const res = await fetch(`${baseUrl}/v1beta/models?key=${apiKey ?? ''}`);
        if (!res.ok) return [];
        const j = await res.json();
        return (j.models ?? []).map((m: { name: string }) => m.name.replace(/^models\//, ''));
      } catch {
        return [];
      }
    },
  };
}
