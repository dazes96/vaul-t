import { describe, it, expect } from 'vitest';
import { getSpecialist, specialistList, SPECIALISTS } from '../src/agent/specialists.js';
import { DESTRUCTIVE_TOOLS } from '../src/agent/tools.js';

describe('specialist roles', () => {
  it('exposes all eight roles with the right write permissions', () => {
    const ids = SPECIALISTS.map(s => s.id).sort();
    expect(ids).toEqual(['architect', 'coder', 'documentation', 'performance', 'planner', 'reviewer', 'security', 'testing']);
    // Only Coder and Documentation may modify files; every review role is read-only.
    const writers = SPECIALISTS.filter(s => s.writes).map(s => s.id).sort();
    expect(writers).toEqual(['coder', 'documentation']);
  });

  it('defaults to the Coder role for unknown or missing ids', () => {
    expect(getSpecialist(undefined).id).toBe('coder');
    expect(getSpecialist('does-not-exist').id).toBe('coder');
    expect(getSpecialist('security').id).toBe('security');
  });

  it('read-only roles are exactly the ones whose mutating tools would be refused', () => {
    // The agent loop refuses DESTRUCTIVE_TOOLS for any non-writing specialist;
    // confirm those are the mutating tools we expect so the guard is meaningful.
    expect([...DESTRUCTIVE_TOOLS].sort()).toEqual(['delete_file', 'run_command', 'write_file']);
  });

  it('every role has a non-empty, role-specific prompt', () => {
    for (const s of SPECIALISTS) {
      expect(s.prompt.length).toBeGreaterThan(20);
      expect(s.label.length).toBeGreaterThan(0);
    }
    // Review roles instruct the model to produce findings, not edit.
    expect(getSpecialist('security').prompt.toLowerCase()).toContain('findings');
    expect(getSpecialist('reviewer').prompt.toLowerCase()).toContain('findings');
  });

  it('specialistList returns the compact shape used by the UI', () => {
    const list = specialistList();
    expect(list).toHaveLength(8);
    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual(['description', 'id', 'label', 'writes']);
    }
  });
});
