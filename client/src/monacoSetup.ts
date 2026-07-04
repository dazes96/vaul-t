// Bundle Monaco locally so the IDE works fully offline (no CDN loader).
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

export { monaco };

export function languageForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.css': 'css', '.scss': 'scss', '.html': 'html', '.htm': 'html',
    '.md': 'markdown', '.py': 'python', '.php': 'php', '.vue': 'html', '.svelte': 'html',
    '.yml': 'yaml', '.yaml': 'yaml', '.sh': 'shell', '.sql': 'sql', '.xml': 'xml',
    '.rs': 'rust', '.go': 'go', '.rb': 'ruby', '.java': 'java', '.toml': 'ini', '.ini': 'ini',
  };
  return map[ext] ?? 'plaintext';
}
