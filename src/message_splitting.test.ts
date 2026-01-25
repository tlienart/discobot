import { expect, test, describe, mock, spyOn, afterAll } from 'bun:test';
import { DiscordClient, type Config } from './discord';
import { EventEmitter } from 'events';
import { unlinkSync, existsSync } from 'fs';

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
    const mockChannel = {
      id: 'chan1',
      send: mock(async () => ({})),
      sendTyping: mock(async () => {}),
    } as any;
    const mockAgent = new EventEmitter() as any;
    mockAgent.getStdoutPath = () => '';
    mockAgent.getStderrPath = () => '';

    (client as any).attachSessionListeners(mockAgent, mockChannel);

    mockAgent.emit('output', 'hello');

    // Small delay to allow async handlers to run
    await new Promise((r) => setTimeout(r, 10));

    expect(mockChannel.send).toHaveBeenCalledWith('hello');
  });

  test('should split medium message (1900-9500)', async () => {
    const client = new DiscordClient(mockConfig);
    const mockChannel = {
      id: 'chan2',
      send: mock(async () => ({})),
      sendTyping: mock(async () => {}),
    } as any;
    const mockAgent = new EventEmitter() as any;
    mockAgent.getStdoutPath = () => '';
    mockAgent.getStderrPath = () => '';

    (client as any).attachSessionListeners(mockAgent, mockChannel);

    // 3000 chars should be 2 messages (1900 + 1100)
    const longMessage = 'a'.repeat(3000);
    mockAgent.emit('output', longMessage);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockChannel.send).toHaveBeenCalledTimes(2);
    expect(mockChannel.send.mock.calls[0][0]).toContain('[1/2]');
    expect(mockChannel.send.mock.calls[1][0]).toContain('[2/2]');
  });

  test('should trigger summarization for very long message (>9500)', async () => {
    const client = new DiscordClient(mockConfig);
    const mockChannel = {
      id: 'chan3',
      send: mock(async () => ({})),
      sendTyping: mock(async () => {}),
    } as any;

    const mockAgent = new EventEmitter() as any;
    mockAgent.getStdoutPath = () => '';
    mockAgent.getStderrPath = () => '';
    mockAgent.start = mock(async () => {});

    // Mock prepareSession to return another mock agent
    spyOn((client as any).sessionManager, 'prepareSession').mockReturnValue(mockAgent);

    (client as any).attachSessionListeners(mockAgent, mockChannel);

    const hugeMessage = 'a'.repeat(10000);
    mockAgent.emit('output', hugeMessage);

    await new Promise((r) => setTimeout(r, 10));

    // Should NOT send the huge message directly
    const sentMessages = mockChannel.send.mock.calls.map((c: any) => c[0]);
    expect(sentMessages).not.toContain(hugeMessage);

    // Should have triggered a new session with summarization prompt
    expect(mockAgent.start).toHaveBeenCalled();
    const prompt = mockAgent.start.mock.calls[0][0];
    expect(prompt).toContain('too long');
    expect(prompt).toContain('9500');
  });
});
