import { sseLines, type ChatMessage, type ChatOptions, type Provider } from './types.js';

/**
 * OpenAI-compatible chat completions API. This one provider covers
 * LM Studio, llama.cpp server, vLLM, OpenRouter, OpenAI, and anything
 * else that speaks /v1/chat/completions.
 */
export function openaiCompatProvider(baseUrl: string, model: string, apiKey?: string): Provider {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return {
    async *streamChat(messages: ChatMessage[], opts: ChatOptions = {}) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: opts.signal,
        body: JSON.stringify({
          model, messages, stream: true,
          temperature: opts.temperature ?? 0.2,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`${baseUrl}: ${res.status} ${await res.text()}`);
      for await (const data of sseLines(res.body)) {
        if (data === '[DONE]') return;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch { /* keep-alive or malformed line — skip */ }
      }
    },

    async complete(prefix, suffix, opts = {}) {
      // Use chat with a strict instruction; works on every compatible server,
      // including ones that don't expose the legacy /completions endpoint.
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a code completion engine. Output ONLY the code that should be inserted at the cursor. No explanations, no markdown fences.' },
        { role: 'user', content: `<before-cursor>\n${prefix}\n</before-cursor>\n<after-cursor>\n${suffix}\n</after-cursor>\nInsert code at the cursor:` },
      ];
      let out = '';
      for await (const d of this.streamChat(messages, { ...opts, temperature: 0.1, maxTokens: opts.maxTokens ?? 128 })) out += d;
      return out.replace(/^```[a-z]*\n?|```$/g, '');
    },

    async listModels() {
      try {
        const res = await fetch(`${baseUrl}/models`, { headers });
        if (!res.ok) return [];
        const j = await res.json();
        return (j.data ?? []).map((m: { id: string }) => m.id);
      } catch {
        return [];
      }
    },
  };
}
