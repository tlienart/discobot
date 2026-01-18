import { expect, test, describe, mock, spyOn, beforeEach, afterAll } from 'bun:test';
import { DiscordClient } from './discord';
import { ChannelType } from 'discord.js';
import { SessionManager } from './sessions';
import { OpenCodeProcess } from './opencode';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = 'sessions.test.json';

describe('DiscordClient', () => {
  afterAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = TEST_DB;
  });

  test('should skip recovery for invalid Snowflake IDs', async () => {
    const dbData = { 'invalid-id': 'session-123' };
    require('fs').writeFileSync(TEST_DB, JSON.stringify(dbData));

    const client = new DiscordClient();
    const fetchSpy = spyOn(client.getClient().channels, 'fetch');

    // @ts-ignore - access private recovery method
    await client.recoverSessions();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.getSessionManager().getChannelMapping().has('invalid-id')).toBe(false);
  });

  test('should throw error if credentials are missing', () => {
    const originalEnv = { ...process.env };
    process.env.DISCORD_TOKEN = '';
    process.env.DISCORD_CLIENT_ID = '';
    process.env.DISCORD_GUILD_ID = '';

    expect(() => new DiscordClient()).toThrow(
      'Missing Discord credentials in environment variables',
    );

    process.env = originalEnv;
  });

  test('should handle /setup command', async () => {
    const client = new DiscordClient();

    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: 'setup',
      options: {
        getChannel: () => ({
          id: '123456789',
          name: 'Sessions',
          type: ChannelType.GuildCategory,
        }),
      },
      reply: mock(async () => {}),
    };

    client.getClient().emit('interactionCreate', mockInteraction as unknown as any);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(client.getCategoryId()).toBe('123456789');
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  test('should handle /new command', async () => {
    const prepareSessionSpy = spyOn(SessionManager.prototype, 'prepareSession').mockReturnValue(new OpenCodeProcess('test-session'));
    const startSpy = spyOn(OpenCodeProcess.prototype, 'start').mockImplementation(async () => {});

    const client = new DiscordClient();
    const mockChannel = {
      id: 'channel-123',
      name: 'opencode-1234',
      type: ChannelType.GuildText,
      send: mock(async () => {}),
    };

    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: 'new',
      options: {
        getString: () => 'hello',
      },
      guild: {
        channels: {
          create: mock(async () => mockChannel),
        },
      },
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
    };

    client.getClient().emit('interactionCreate', mockInteraction as any);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockInteraction.guild.channels.create).toHaveBeenCalled();
    expect(prepareSessionSpy).toHaveBeenCalledWith('channel-123');
    expect(startSpy).toHaveBeenCalledWith('hello');
    expect(mockInteraction.editReply).toHaveBeenCalled();

    prepareSessionSpy.mockRestore();
    startSpy.mockRestore();
  });

  test('should handle messageCreate for input injection', async () => {
    const sendInputSpy = mock(() => {});
    const getSessionSpy = spyOn(SessionManager.prototype, 'getSession').mockImplementation(
      () =>
        ({
          sendInput: sendInputSpy,
        }) as any,
    );

    const client = new DiscordClient();
    const mockMessage = {
      author: { bot: false },
      channelId: 'channel-123',
      content: 'inject this',
      react: mock(async () => {}),
    };

    client.getClient().emit('messageCreate', mockMessage as any);

    expect(getSessionSpy).toHaveBeenCalledWith('channel-123');
    expect(sendInputSpy).toHaveBeenCalledWith('inject this');

    getSessionSpy.mockRestore();
  });
});
