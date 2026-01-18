import { expect, test, describe, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { DiscordClient } from './discord';
import { SessionManager } from './sessions';
import { ChannelType, type Guild, type Message, type TextChannel } from 'discord.js';
import { EventEmitter } from 'events';
import { existsSync, unlinkSync } from 'fs';
import { type Agent } from './agent';

describe('Integration: Full Flow', () => {
  let client: DiscordClient;
  let mockGuild: unknown;
  let mockChannel: EventEmitter & {
    id: string;
    send: ReturnType<typeof mock>;
    sendTyping: ReturnType<typeof mock>;
    type: ChannelType;
  };
  let mockProcess: EventEmitter & {
    start: ReturnType<typeof mock>;
    sendInput: ReturnType<typeof mock>;
    stop: ReturnType<typeof mock>;
    getPid: ReturnType<typeof mock>;
    getStdoutPath: ReturnType<typeof mock>;
    getStderrPath: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = 'integration.test.json';

    // @ts-expect-error: mocking
    mockChannel = new EventEmitter();
    mockChannel.id = 'channel-123';
    mockChannel.send = mock(async () => ({}));
    mockChannel.sendTyping = mock(async () => ({}));
    mockChannel.type = ChannelType.GuildText;

    mockGuild = {
      channels: {
        create: mock(async () => mockChannel),
        fetch: mock(async () => mockChannel),
      },
    };

    // Mock SessionManager to avoid actual spawn
    // @ts-expect-error: mocking
    mockProcess = new EventEmitter();
    mockProcess.start = mock(async () => {});
    mockProcess.sendInput = mock(() => {});
    mockProcess.stop = mock(() => {});
    mockProcess.getPid = mock(() => 123);
    mockProcess.getStdoutPath = mock(() => 'stdout');
    mockProcess.getStderrPath = mock(() => 'stderr');

    const mockSessionCreator = (channelId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.getSessionManager() as any).sessions.set(channelId, mockProcess as unknown as Agent);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.getSessionManager() as any).channelToType.set(channelId, 'persistent');
      return mockProcess as unknown as Agent;
    };

    spyOn(SessionManager.prototype, 'prepareSession').mockImplementation(mockSessionCreator);
    spyOn(SessionManager.prototype, 'prepareOneShotSession').mockImplementation(mockSessionCreator);

    client = new DiscordClient();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SessionManager.prototype.prepareSession as any).mockRestore?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SessionManager.prototype.prepareOneShotSession as any).mockRestore?.();
    if (existsSync('integration.test.json')) {
      unlinkSync('integration.test.json');
    }
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
        },
      },
      guild: mockGuild as Guild,
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
      channelId: 'cmd-channel',
    };

    // @ts-expect-error: mocking
    discordClient.emit('interactionCreate', mockInteraction);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect((mockGuild as Guild).channels.create).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    expect(mockProcess.start).toHaveBeenCalledWith('Start test session');

    // 2. Simulate opencode output
    mockProcess.emit('output', 'Hello from OpenCode!');
    expect(mockChannel.send).toHaveBeenCalledWith('Hello from OpenCode!');

    // 3. Simulate thinking status
    mockProcess.emit('thinking', true);
    expect(mockChannel.sendTyping).toHaveBeenCalled();

    // 4. Simulate user input in Discord
    const mockMessage = {
      author: { bot: false },
      channelId: 'channel-123',
      content: 'Hello agent!',
      react: mock(async () => {}),
      channel: mockChannel as unknown as TextChannel,
    } as unknown as Message;

    // @ts-expect-error: mocking
    discordClient.emit('messageCreate', mockMessage);
    expect(mockProcess.sendInput).toHaveBeenCalledWith('Hello agent!');
    expect(mockMessage.react).toHaveBeenCalledWith('📥');
  });
});
