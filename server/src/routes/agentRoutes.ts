import { Router } from 'express';
import { specialistList } from '../agent/specialists.js';

/** Metadata about the agent — currently the list of specialist roles for the UI. */
export function agentRoutes(): Router {
  const r = Router();
  r.get('/roles', (_req, res) => res.json({ roles: specialistList() }));
  return r;
}
