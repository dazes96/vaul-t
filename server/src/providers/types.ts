export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Every backend implements this one interface. Adding a new provider means
 * writing a single file that turns (messages) into an async stream of text
 * deltas — nothing else in the app changes.
 */
export interface Provider {
  /** Stream a chat completion as plain-text deltas. */
  streamChat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
  /** Fill-in-the-middle / prefix completion for inline autocomplete. */
  complete(prefix: string, suffix: string, opts?: ChatOptions): Promise<string>;
  /** List model names available on this backend (best effort). */
  listModels(): Promise<string[]>;
}

/** Read SSE `data:` lines from a fetch body. Shared by several providers. */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
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
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}
