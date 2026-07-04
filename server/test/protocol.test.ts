import { describe, it, expect } from 'vitest';
import { parseActions } from '../src/agent/protocol.js';

describe('agent action protocol', () => {
  it('parses a single action block', () => {
    const text = 'I will read the file first.\n```action\n{"tool":"read_file","path":"src/app.ts"}\n```';
    const { actions, narration } = parseActions(text);
    expect(actions).toEqual([{ tool: 'read_file', path: 'src/app.ts' }]);
    expect(narration).toBe('I will read the file first.');
  });

  it('parses multiple action blocks', () => {
    const text = '```action\n{"tool":"list_dir","path":"."}\n```\ntext between\n```action\n{"tool":"search","query":"TODO"}\n```';
    const { actions } = parseActions(text);
    expect(actions).toHaveLength(2);
    expect(actions[1].tool).toBe('search');
  });

  it('ignores malformed JSON without crashing', () => {
    const text = '```action\n{not json}\n```';
    const { actions } = parseActions(text);
    expect(actions).toHaveLength(0);
  });

  it('returns no actions for plain text (task complete)', () => {
    const { actions, narration } = parseActions('All done! I updated the header.');
    expect(actions).toHaveLength(0);
    expect(narration).toContain('All done');
  });

  it('handles multi-line JSON content in write_file', () => {
    const content = JSON.stringify({ tool: 'write_file', path: 'a.txt', content: 'line1\nline2' });
    const { actions } = parseActions('```action\n' + content + '\n```');
    expect(actions[0].content).toBe('line1\nline2');
  });

  it('extracts a plan block separately from narration and actions', () => {
    const text = [
      'I will fix the bug.',
      '```plan',
      '1. Read the file',
      '2. Fix the null check',
      '```',
      '```action',
      '{"tool":"read_file","path":"src/a.ts"}',
      '```',
    ].join('\n');
    const { plan, narration, actions } = parseActions(text);
    expect(plan).toBe('1. Read the file\n2. Fix the null check');
    expect(narration).toBe('I will fix the bug.');
    expect(actions).toHaveLength(1);
  });

  it('returns plan: null when there is no plan block', () => {
    const { plan } = parseActions('```action\n{"tool":"list_dir","path":"."}\n```');
    expect(plan).toBeNull();
  });

  it('handles a plan block with no actions (pure planning turn)', () => {
    const { plan, actions } = parseActions('```plan\n1. First I will look around\n```');
    expect(plan).toBe('1. First I will look around');
    expect(actions).toHaveLength(0);
  });
});
