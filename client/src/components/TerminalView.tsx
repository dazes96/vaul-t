import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/** Integrated terminal — a real shell on your machine over a local WebSocket. */
export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current!;
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      theme: document.documentElement.dataset.theme === 'light'
        ? { background: '#ffffff', foreground: '#24292f', cursor: '#24292f' }
        : { background: '#1e1f22', foreground: '#d6d8dc', cursor: '#34d399' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'data') term.write(msg.data);
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onclose = () => term.write('\r\n[terminal session ended]\r\n');
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(el);

    return () => { observer.disconnect(); ws.close(); term.dispose(); };
  }, []);

  return <div ref={containerRef} style={{ height: '100%', padding: '4px 8px' }} />;
}
