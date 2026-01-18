import { expect, test, describe, mock, spyOn, beforeEach } from 'bun:test';
import { DiscordClient } from './discord';
import { SessionManager } from './sessions';
import { ChannelType } from 'discord.js';
import { EventEmitter } from 'events';

describe('Integration: Full Flow', () => {
  let client: DiscordClient;
  let mockGuild: any;
  let mockChannel: any;
  let mockProcess: any;

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = 'integration.test.json';

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
    mockProcess = new EventEmitter();
    mockProcess.start = mock(async () => {});
    mockProcess.sendInput = mock(() => {});
    mockProcess.stop = mock(() => {});

    const mockSessionCreator = (channelId: string) => {
      // @ts-ignore
      client.getSessionManager().sessions.set(channelId, mockProcess);
      // @ts-ignore
      client.getSessionManager().channelToType.set(channelId, 'persistent');
      return mockProcess as any;
    };

    spyOn(SessionManager.prototype, 'prepareSession').mockImplementation(mockSessionCreator);
    spyOn(SessionManager.prototype, 'prepareOneShotSession').mockImplementation(mockSessionCreator);

    client = new DiscordClient();
    // @ts-ignore
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
      guild: mockGuild,
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
      channelId: 'cmd-channel',
    };

    discordClient.emit('interactionCreate', mockInteraction as any);
    await new Promise((resolve) => setTimeout(resolve, 20));

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
      channelId: 'channel-123',
      content: 'Hello agent!',
      react: mock(async () => {}),
    };

    discordClient.emit('messageCreate', mockMessage as any);
    expect(mockProcess.sendInput).toHaveBeenCalledWith('Hello agent!');
    expect(mockMessage.react).toHaveBeenCalledWith('📥');

    if (require('fs').existsSync('integration.test.json')) {
      require('fs').unlinkSync('integration.test.json');
    }
  });
});
