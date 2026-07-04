import { Router } from 'express';
import { detectVerifySteps } from '../verify/detect.js';
import { runVerification } from '../verify/runner.js';

/**
 * Verification as a service: detect steps, run them, stream progress.
 * Used both by the manual "Run verification" button and by the agent's
 * self-healing loop (agent/agent.ts calls runVerification directly for that
 * path so it can react to failures inline; this route is for the UI).
 */
export function verifyRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/steps', (_req, res) => {
    res.json({ steps: detectVerifySteps(getWorkspace()) });
  });

  r.post('/run', async (req, res) => {
    const workspace = getWorkspace();
    const steps = detectVerifySteps(workspace);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.flushHeaders();
    const send = (obj: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    if (steps.length === 0) {
      send({ type: 'done', results: [], reason: 'No typecheck/lint/test/build scripts detected in package.json.' });
      return res.end();
    }
    send({ type: 'steps', steps });
    const results = await runVerification(
      workspace, steps,
      (result) => send({ type: 'step-result', result }),
      (id, chunk) => send({ type: 'output', id, chunk }),
    );
    send({ type: 'done', results });
    res.end();
  });

  return r;
}
