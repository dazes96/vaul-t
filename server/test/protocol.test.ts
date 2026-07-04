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
});
