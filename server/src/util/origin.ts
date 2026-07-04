/**
 * Cross-origin guard.
 *
 * Emerald binds to localhost, but that alone does NOT protect it: any web page
 * you visit in a browser can issue requests to http://127.0.0.1:4620 and open
 * ws://127.0.0.1:4620 sockets (DNS-rebinding / CSRF). Since this server can
 * read/write your files and spawn a shell, an unguarded page could drive it.
 *
 * Defense: reject browser requests whose Origin is not a loopback address.
 * A malicious site sends its own real Origin (e.g. https://evil.example), which
 * fails this check. Non-browser tools (curl, editors, scripts) send no Origin
 * and are allowed, so local automation keeps working.
 */

function hostnameOf(origin: string): string | null {
  try { return new URL(origin).hostname; } catch { return null; }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true;               // non-browser client (curl, native app)
  const host = hostnameOf(origin);
  return host !== null && (LOOPBACK.has(host) || host.endsWith('.localhost'));
}
