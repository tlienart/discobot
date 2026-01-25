import { expect, test, describe, mock, spyOn, afterAll } from 'bun:test';
import { DiscordClient, type Config } from './discord';
import { EventEmitter } from 'events';
import { unlinkSync, existsSync } from 'fs';
import type { TextChannel } from 'discord.js';
import type { Agent } from './agent';

interface MockChannel {
  id: string;
  send: ReturnType<typeof mock>;
  sendTyping: ReturnType<typeof mock>;
}

interface MockAgent extends EventEmitter {
  getStdoutPath: ReturnType<typeof mock>;
  getStderrPath: ReturnType<typeof mock>;
  start: ReturnType<typeof mock>;
}

const TEST_DB = 'sessions.test_split.json';

const mockConfig: Config = {
  discord: {
    token: 'test-token',
    clientId: 'test-client-id',
    guildId: 'test-guild-id',
    sessionDb: TEST_DB,
  },
  sandbox: {
    enabled: true,
    workspaceDir: './workspace-test',
    sandboxGhToken: 'test-gh-token',
    opencodeConfigPath: './opencode.json',
  },
};

describe('DiscordClient Message Splitting', () => {
  afterAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test('should send small message directly', async () => {
    const client = new DiscordClient(mockConfig);
    const mockChannel: MockChannel = {
      id: 'chan1',
      send: mock(async () => ({})),
      sendTyping: mock(async () => {}),
    };
    const mockAgent = new EventEmitter() as MockAgent;
    mockAgent.getStdoutPath = mock(() => '');
    mockAgent.getStderrPath = mock(() => '');

    // @ts-expect-error - accessing private method for testing
    client.attachSessionListeners(
      mockAgent as unknown as Agent,
      mockChannel as unknown as TextChannel,
    );

    mockAgent.emit('output', 'hello');

    // Small delay to allow async handlers to run
    await new Promise((r) => setTimeout(r, 10));

    expect(mockChannel.send).toHaveBeenCalledWith('hello');
  });

  test('should split medium message (1900-9500)', async () => {
    const client = new DiscordClient(mockConfig);
    const mockChannel: MockChannel = {
      id: 'chan2',
      send: mock(async () => ({})),
      sendTyping: mock(async () => {}),
    };
    const mockAgent = new EventEmitter() as MockAgent;
    mockAgent.getStdoutPath = mock(() => '');
    mockAgent.getStderrPath = mock(() => '');

    // @ts-expect-error - accessing private method for testing
    client.attachSessionListeners(
      mockAgent as unknown as Agent,
      mockChannel as unknown as TextChannel,
    );

    // 3000 chars should be 2 messages (1900 + 1100)
    const longMessage = 'a'.repeat(3000);
    mockAgent.emit('output', longMessage);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockChannel.send).toHaveBeenCalledTimes(2);
    const calls = mockChannel.send.mock.calls;
    if (calls[0] && calls[1]) {
      expect(calls[0][0]).toContain('[1/2]');
      expect(calls[1][0]).toContain('[2/2]');
    } else {
      throw new Error('Expected 2 calls to send');
    }
  });

  test('should trigger summarization for very long message (>9500)', async () => {
    const client = new DiscordClient(mockConfig);
    const mockChannel: MockChannel = {
      id: 'chan3',
      send: mock(async () => ({})),
      sendTyping: mock(async () => {}),
    };

    const mockAgent = new EventEmitter() as MockAgent;
    mockAgent.getStdoutPath = mock(() => '');
    mockAgent.getStderrPath = mock(() => '');
    mockAgent.start = mock(async () => {});

    // Mock prepareSession to return another mock agent
    // @ts-expect-error - accessing private property
    spyOn(client.sessionManager, 'prepareSession').mockReturnValue(mockAgent as unknown as Agent);

    // @ts-expect-error - accessing private method for testing
    client.attachSessionListeners(
      mockAgent as unknown as Agent,
      mockChannel as unknown as TextChannel,
    );

    const hugeMessage = 'a'.repeat(10000);
    mockAgent.emit('output', hugeMessage);

    await new Promise((r) => setTimeout(r, 10));

    // Should NOT send the huge message directly
    const sentMessages = mockChannel.send.mock.calls.map((c) => c[0]);
    expect(sentMessages).not.toContain(hugeMessage);

    // Should have triggered a new session with summarization prompt
    expect(mockAgent.start).toHaveBeenCalled();
    const startCalls = mockAgent.start.mock.calls;
    if (startCalls[0]) {
      const prompt = startCalls[0][0] as string;
      expect(prompt).toContain('too long');
      expect(prompt).toContain('9500');
    } else {
      throw new Error('Expected 1 call to start');
    }
  });
});
