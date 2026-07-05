import { describe, it, expect } from 'vitest';
import { buildProvider } from '../src/providers/registry.js';
import { DEFAULT_SETTINGS, type Settings } from '../src/config.js';

function settingsWith(overrides: Partial<Settings>): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

describe('buildProvider selection', () => {
  it('builds the active provider by default', () => {
    const p = buildProvider(settingsWith({ activeProvider: 'ollama' }));
    expect(typeof p.streamChat).toBe('function');
  });

  it('builds a specific provider by id when asked', () => {
    const p = buildProvider(settingsWith({}), 'lm-studio');
    expect(typeof p.streamChat).toBe('function');
  });

  it('throws an ACTIONABLE error when the active provider is missing', () => {
    // Simulates the dangling-activeProvider state (e.g. the active one was deleted).
    const s = settingsWith({ activeProvider: 'ghost', providers: [{ id: 'real', kind: 'ollama', baseUrl: 'x', model: 'y' }] });
    expect(() => buildProvider(s)).toThrow(/open Settings/i);
    expect(() => buildProvider(s)).toThrow(/real/);   // lists what IS configured
  });

  it('throws a clear error for an unknown provider kind', () => {
    const s = settingsWith({ activeProvider: 'weird', providers: [{ id: 'weird', kind: 'made-up' as never, baseUrl: 'x', model: 'y' }] });
    expect(() => buildProvider(s)).toThrow(/unknown kind/i);
  });
});
