import { expect, test, describe, mock, spyOn, beforeEach } from 'bun:test';
import { DiscordClient } from './discord';
import { SessionManager } from './sessions';
import { ChannelType, type Guild, type TextChannel } from 'discord.js';
import { EventEmitter } from 'events';
import { existsSync, unlinkSync } from 'fs';
import { type Agent } from './agent';

describe('Integration: Full Flow', () => {
  let client: DiscordClient;
  let mockGuild: unknown;
  let mockChannel: EventEmitter;
  let mockProcess: EventEmitter;

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = 'integration.test.json';

    mockChannel = new EventEmitter();
    // @ts-expect-error: mocking
    mockChannel.id = 'channel-123';
    // @ts-expect-error: mocking
    mockChannel.send = mock(async () => ({}));
    // @ts-expect-error: mocking
    mockChannel.sendTyping = mock(async () => ({}));
    // @ts-expect-error: mocking
    mockChannel.type = ChannelType.GuildText;

    mockGuild = {
      channels: {
        create: mock(async () => mockChannel),
        fetch: mock(async () => mockChannel),
      },
    };

    // Mock SessionManager to avoid actual spawn
    mockProcess = new EventEmitter();
    // @ts-expect-error: mocking
    mockProcess.start = mock(async () => {});
    // @ts-expect-error: mocking
    mockProcess.sendInput = mock(() => {});
    // @ts-expect-error: mocking
    mockProcess.stop = mock(async () => {});
    // @ts-expect-error: mocking
    mockProcess.getStdoutPath = mock(() => 'test.stdout');
    // @ts-expect-error: mocking
    mockProcess.getStderrPath = mock(() => 'test.stderr');

    const mockSessionCreator = (channelId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.getSessionManager() as any).sessions.set(channelId, mockProcess);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.getSessionManager() as any).channelToType.set(channelId, 'persistent');
      return mockProcess as unknown as Agent;
    };

    spyOn(SessionManager.prototype, 'prepareSession').mockImplementation(mockSessionCreator);
    spyOn(SessionManager.prototype, 'prepareOneShotSession').mockImplementation(mockSessionCreator);

    client = new DiscordClient();
    client.getSessionManager().setCategoryId('cat-123');
  });

  test('should handle new session, relay output, and inject input', async () => {
    const discordClient = client.getClient();

    // 1. Simulate /new command
    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: 'new',
      options: {
        getString: (name: string) => {
           if (name === 'prompt') return 'Start test session';
           if (name === 'mode') return 'persistent';
           return null;
        }
      },
      guild: mockGuild as Guild,
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
      channelId: 'cmd-channel',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    discordClient.emit('interactionCreate', mockInteraction as any);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect((mockGuild as { channels: { create: unknown } }).channels.create).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    // @ts-expect-error: mocking
    expect(mockProcess.start).toHaveBeenCalledWith('Start test session');

    // 2. Simulate opencode output
    mockProcess.emit('output', 'Hello from OpenCode!');
    // @ts-expect-error: mocking
    expect(mockChannel.send).toHaveBeenCalledWith('Hello from OpenCode!');

    // 3. Simulate thinking status
    mockProcess.emit('thinking', true);
    // @ts-expect-error: mocking
    expect(mockChannel.sendTyping).toHaveBeenCalled();

    // 4. Simulate user input in Discord
    const mockMessage = {
      author: { bot: false },
      channelId: 'channel-123',
      content: 'Hello agent!',
      react: mock(async () => {}),
      channel: mockChannel as unknown as TextChannel,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    discordClient.emit('messageCreate', mockMessage as any);
    // @ts-expect-error: mocking
    expect(mockProcess.sendInput).toHaveBeenCalledWith('Hello agent!');
    expect(mockMessage.react).toHaveBeenCalledWith('📥');

    if (existsSync('integration.test.json')) {
      unlinkSync('integration.test.json');
    }
  });
});
