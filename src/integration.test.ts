import { expect, test, describe, mock, spyOn, beforeEach } from 'bun:test';
import { DiscordClient } from './discord';
import { SessionManager } from './sessions';
import { ChannelType, type Message, type ChatInputCommandInteraction } from 'discord.js';
import { EventEmitter } from 'events';
import { existsSync, unlinkSync } from 'fs';
import { type Agent } from './agent';

describe('Integration: Full Flow', () => {
  let client: DiscordClient;
  let mockGuild: unknown;
  let mockChannel: unknown;
  let mockProcess: unknown;

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = 'integration.test.json';

    const channel = new EventEmitter();
    // @ts-expect-error - mock setup
    channel.id = 'channel-123';
    // @ts-expect-error - mock setup
    channel.send = mock(async () => ({}));
    // @ts-expect-error - mock setup
    channel.sendTyping = mock(async () => ({}));
    // @ts-expect-error - mock setup
    channel.type = ChannelType.GuildText;
    mockChannel = channel;

    mockGuild = {
      channels: {
        create: mock(async () => mockChannel),
        fetch: mock(async () => mockChannel),
      },
    };

    // Mock SessionManager to avoid actual spawn
    const proc = new EventEmitter();
    // @ts-expect-error - mock setup
    proc.start = mock(async () => {});
    // @ts-expect-error - mock setup
    proc.sendInput = mock(() => {});
    // @ts-expect-error - mock setup
    proc.stop = mock(() => {});
    mockProcess = proc;

    const mockSessionCreator = (channelId: string) => {
      // @ts-expect-error - accessing private map
      client.getSessionManager().sessions.set(channelId, mockProcess as Agent);
      // @ts-expect-error - accessing private map
      client.getSessionManager().channelToType.set(channelId, 'standard');
      return mockProcess as Agent;
    };

    spyOn(SessionManager.prototype, 'prepareSession').mockImplementation(mockSessionCreator);

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
          return null;
        },
      },
      guild: mockGuild,
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
      channelId: 'cmd-channel',
    };

    discordClient.emit(
      'interactionCreate',
      mockInteraction as unknown as ChatInputCommandInteraction,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    const g = mockGuild as { channels: { create: ReturnType<typeof mock> } };
    expect(g.channels.create).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    const p = mockProcess as { start: ReturnType<typeof mock> };
    expect(p.start).toHaveBeenCalledWith('Start test session');

    // 2. Simulate opencode output
    (mockProcess as EventEmitter).emit('output', 'Hello from OpenCode!');
    const c = mockChannel as { send: ReturnType<typeof mock> };
    expect(c.send).toHaveBeenCalledWith('Hello from OpenCode!');

    // 3. Simulate thinking status
    (mockProcess as EventEmitter).emit('thinking', true);
    const ct = mockChannel as { sendTyping: ReturnType<typeof mock> };
    expect(ct.sendTyping).toHaveBeenCalled();

    // 4. Simulate user input in Discord
    const mockMessage = {
      author: { bot: false },
      channelId: 'channel-123',
      content: 'Hello agent!',
      react: mock(async () => {}),
      channel: mockChannel,
    };

    // @ts-expect-error - mock message emission
    discordClient.emit('messageCreate', mockMessage as Message);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(p.start).toHaveBeenCalledWith('Hello agent!');
    expect(mockMessage.react).toHaveBeenCalledWith('📥');

    if (existsSync('integration.test.json')) {
      unlinkSync('integration.test.json');
    }
  });
});
