// Thin typed client for the Emerald server API.

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? res.statusText);
  return res.json();
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? res.statusText);
  return res.json();
}

export async function apiDelete(url: string): Promise<void> {
  await fetch(url, { method: 'DELETE' });
}

export interface ChatMessage { role: 'user' | 'assistant' | 'system'; content: string }

/** POST /api/ai/chat and stream SSE deltas to a callback. Returns full text. */
export async function streamChat(
  body: { messages: ChatMessage[]; mode?: string; includeContext?: boolean },
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Chat failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!chunk.startsWith('data:')) continue;
      const j = JSON.parse(chunk.slice(5));
      if (j.error) throw new Error(j.error);
      if (j.delta) { full += j.delta; onDelta(j.delta); }
    }
  }
  return full;
}
