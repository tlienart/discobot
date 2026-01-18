import { expect, test, describe } from 'bun:test';
import { OpenCodeProcess, OneShotOpenCodeProcess } from './opencode';

describe('OpenCodeProcess', () => {
  test('should parse JSON events and emit corresponding events', async () => {
    const op = new OpenCodeProcess('test-session');

    let thinking = false;
    let output = '';
    let idle = false;
    const eventData: unknown[] = [];

    op.on('thinking', (val) => (thinking = val));
    op.on('output', (val) => (output += val));
    op.on('idle', () => (idle = true));
    op.on('event', (e) => eventData.push(e));

    // Simulate chunks
    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"step_start","sessionID":"sid123"}\n');
    expect(thinking).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((eventData[0] as any).sessionID).toBe('sid123');

    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"text","part":{"type":"text","text":"hello"}}\n');
    expect(output).toBe('hello');

    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"step_finish","part":{"reason":"stop"}}\n');
    expect(thinking).toBe(false);
    expect(idle).toBe(true);
  });
});

describe('OneShotOpenCodeProcess', () => {
  test('should parse JSON events and emit corresponding events', async () => {
    const op = new OneShotOpenCodeProcess('test-oneshot');

    let thinking = false;
    let output = '';
    const eventData: unknown[] = [];

    op.on('thinking', (val) => (thinking = val));
    op.on('output', (val) => (output += val));
    op.on('event', (e) => eventData.push(e));

    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"step_start","sessionID":"oneshot123"}\n');
    expect(thinking).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((eventData[0] as any).sessionID).toBe('oneshot123');

    // @ts-expect-error: accessing private method for testing
    op.handleChunk('{"type":"text","text":"immediate response"}\n');
    expect(output).toBe('immediate response');
  });
});
