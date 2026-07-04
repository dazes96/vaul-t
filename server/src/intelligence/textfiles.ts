import path from 'node:path';

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.php', '.vue', '.svelte',
  '.html', '.css', '.scss', '.less', '.json', '.md', '.txt', '.yml', '.yaml',
  '.sh', '.sql', '.rs', '.go', '.rb', '.java', '.xml', '.toml', '.ini', '.cfg', '.env.example',
]);

const NAMED = /(^|\/)(Makefile|Dockerfile|LICENSE|\.env\.example|\.gitignore)$/;

/** Files worth reading/indexing/searching as text. */
export function isTextFile(p: string): boolean {
  return TEXT_EXT.has(path.extname(p).toLowerCase()) || NAMED.test(p);
}

/** Files we try to extract symbols and imports from. */
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.php', '.vue', '.svelte']);
export function isCodeFile(p: string): boolean {
  return CODE_EXT.has(path.extname(p).toLowerCase());
}
