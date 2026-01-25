import { expect, test, describe } from 'bun:test';
import { OpenCodeAgent, type OpenCodeEvent } from './opencode';

describe('OpenCodeAgent', () => {
  test('should parse JSON events and emit corresponding events', async () => {
    const op = new OpenCodeAgent('test-session');

    let thinking = false;
    let output = '';
    let idle = false;
    let eventData: OpenCodeEvent | null = null;

    op.on('thinking', (val: boolean) => (thinking = val));
    op.on('output', (val: string) => (output += val));
    op.on('idle', () => (idle = true));
    op.on('event', (e: OpenCodeEvent) => (eventData = e));

    // Simulate chunks
    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"step_start","sessionID":"sid123"}\n');
    expect(thinking).toBe(true);
    expect((eventData as unknown as OpenCodeEvent).sessionID).toBe('sid123');

    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"text","part":{"type":"text","text":"hello"}}\n');
    expect(output).toBe('hello');

    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"tool_use","part":{"type":"tool_use","text":"ls"}}\n');
    expect(output).toBe('hello'); // Should NOT have changed
    expect((eventData as unknown as OpenCodeEvent).type).toBe('tool_use');

    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"step_finish","part":{"reason":"stop"}}\n');
    expect(thinking).toBe(false);
    expect(idle).toBe(true);
  });

  test('should include --agent flag if provided', async () => {
    const op = new OpenCodeAgent('test-session', { mode: 'build' });
    // @ts-expect-error: accessing private field for testing
    expect(op.mode).toBe('build');
  });
});
