import type { WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Integrated terminal over WebSocket.
 *
 * Uses node-pty when available (full TTY: colors, interactive programs),
 * falling back to a plain child_process pipe shell that works everywhere
 * with zero native compilation. `npm install node-pty` upgrades it.
 */
export async function handleTerminalSocket(ws: WebSocket, cwd: string): Promise<void> {
  const shell = process.platform === 'win32'
    ? (process.env.COMSPEC || 'powershell.exe')
    : (process.env.SHELL || '/bin/bash');

  let pty: { write(d: string): void; resize(c: number, r: number): void; kill(): void } | null = null;
  let child: ChildProcess | null = null;

  try {
    const nodePty = await import('node-pty' as string);
    const p = nodePty.spawn(shell, [], { name: 'xterm-256color', cwd, cols: 80, rows: 24, env: process.env as Record<string, string> });
    p.onData((d: string) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data: d })); });
    p.onExit(() => ws.close());
    pty = p;
  } catch {
    // Fallback: pipe shell. Interactive TUIs won't render, but commands work.
    child = spawn(shell, process.platform === 'win32' ? [] : ['-i'], { cwd, env: process.env });
    const fwd = (d: Buffer) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data: d.toString() })); };
    child.stdout?.on('data', fwd);
    child.stderr?.on('data', fwd);
    child.on('close', () => ws.close());
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: '[Emerald] Basic terminal mode (install optional node-pty for a full TTY).\r\n' }));
    }
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'input') {
        if (pty) pty.write(msg.data);
        else child?.stdin?.write(msg.data.replace(/\r/g, '\n'));
      } else if (msg.type === 'resize' && pty) {
        pty.resize(msg.cols, msg.rows);
      }
    } catch { /* ignore malformed frames */ }
  });

  ws.on('close', () => {
    pty?.kill();
    child?.kill();
  });
}
