import fs from 'node:fs';
import path from 'node:path';

/**
 * Example plugin with real logic: counts lines of code in a directory.
 * GET /api/plugins/wordcount/count?dir=/absolute/path
 */
export default function register(api) {
  api.addRoute('/count', (req, res) => {
    const dir = String(req.query.dir ?? '.');
    let files = 0;
    let lines = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          try {
            files++;
            lines += fs.readFileSync(p, 'utf8').split('\n').length;
          } catch { /* binary file */ }
        }
      }
    };
    try {
      walk(dir);
      res.json({ files, lines });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}
