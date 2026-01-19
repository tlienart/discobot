import { expect, test, describe, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { DiscordClient } from './discord';
import { SessionManager } from './sessions';
import { ChannelType, type Message, type ChatInputCommandInteraction } from 'discord.js';
import { EventEmitter } from 'events';
import { existsSync, unlinkSync } from 'fs';
import { type Agent } from './agent';

interface MockAgent extends EventEmitter {
  start: ReturnType<typeof mock>;
  sendInput: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
  getPid: ReturnType<typeof mock>;
  getStdoutPath: ReturnType<typeof mock>;
  getStderrPath: ReturnType<typeof mock>;
}

describe('Integration: Full Flow', () => {
  let client: DiscordClient;
  let mockGuild: {
    channels: {
      create: ReturnType<typeof mock>;
      fetch: ReturnType<typeof mock>;
    };
  };
  let mockChannel: EventEmitter & {
    id: string;
    send: ReturnType<typeof mock>;
    sendTyping: ReturnType<typeof mock>;
    type: ChannelType;
  };
  let mockProcess: MockAgent;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = 'integration.test.json';

    if (existsSync('integration.test.json')) {
      unlinkSync('integration.test.json');
    }

    const channel = new EventEmitter();
    // @ts-expect-error - mock setup
    channel.id = 'channel-integration-123';
    // @ts-expect-error - mock setup
    channel.send = mock(async () => ({}));
    // @ts-expect-error - mock setup
    channel.sendTyping = mock(async () => ({}));
    // @ts-expect-error - mock setup
    channel.type = ChannelType.GuildText;
    mockChannel = channel as unknown as typeof mockChannel;

    mockGuild = {
      channels: {
        create: mock(async () => mockChannel),
        fetch: mock(async () => mockChannel),
      },
    };

    // Mock SessionManager to avoid actual spawn
    const proc = new EventEmitter() as MockAgent;
    proc.start = mock(async () => Promise.resolve());
    proc.sendInput = mock(() => {});
    proc.stop = mock(() => {});
    proc.getPid = mock(() => 123);
    proc.getStdoutPath = mock(() => 'stdout');
    proc.getStderrPath = mock(() => 'stderr');
    mockProcess = proc;

    const mockSessionCreator = (channelId: string) => {
      // @ts-expect-error - accessing private map
      client.getSessionManager().sessions.set(channelId, mockProcess as Agent);
      // @ts-expect-error - accessing private map
      client.getSessionManager().channelToType.set(channelId, 'standard');
      return mockProcess as Agent;
    };

    const prepareSpy = spyOn(SessionManager.prototype, 'prepareSession').mockImplementation(
      mockSessionCreator,
    );
    spies.push(prepareSpy);

    client = new DiscordClient();
    client.getSessionManager().setCategoryId('cat-integration-123');
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
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
          return null;
        },
      },
      guild: mockGuild,
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
      channelId: 'cmd-integration-channel',
    };

    discordClient.emit(
      'interactionCreate',
      mockInteraction as unknown as ChatInputCommandInteraction,
    );

    // Robust wait for start call
    for (let i = 0; i < 250 && mockProcess.start.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockGuild.channels.create).toHaveBeenCalled();
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
      channelId: 'channel-integration-123',
      content: 'Hello agent!',
      react: mock(async () => {}),
      channel: mockChannel,
    };

    // @ts-expect-error - mock message emission
    discordClient.emit('messageCreate', mockMessage as Message);

    // Robust wait for second start call
    for (let i = 0; i < 250 && mockProcess.start.mock.calls.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(mockProcess.start).toHaveBeenCalledWith('Hello agent!');
    expect(mockMessage.react).toHaveBeenCalledWith('📥');
  });
});
