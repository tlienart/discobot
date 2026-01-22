import { expect, test, describe, mock, spyOn, beforeEach, afterAll, afterEach } from 'bun:test';
import { DiscordClient } from './discord';
import { ChannelType, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { SessionManager } from './sessions';
import { OpenCodeAgent } from './opencode';
import { unlinkSync, existsSync, writeFileSync } from 'fs';

const TEST_DB = 'sessions.test.json';

describe('DiscordClient', () => {
  const spies: { mockRestore: () => void }[] = [];

  afterAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = TEST_DB;
  });

  test('should skip recovery for invalid Snowflake IDs', async () => {
    const dbData = { channels: { 'invalid-id': 'session-123' } };
    writeFileSync(TEST_DB, JSON.stringify(dbData));

    const client = new DiscordClient();
    const fetchSpy = spyOn(client.getClient().channels, 'fetch');
    spies.push(fetchSpy);

    await (client as unknown as { recoverSessions: () => Promise<void> }).recoverSessions();

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

  test('should handle /bind command', async () => {
    const client = new DiscordClient();
    const bindSpy = spyOn(SessionManager.prototype, 'bindChannelToFolder').mockReturnValue(
      'my-folder',
    );
    spies.push(bindSpy);

    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: 'bind',
      options: {
        getString: () => 'my-folder',
      },
      channelId: '123',
      reply: mock(async () => {}),
    };

    client
      .getClient()
      .emit('interactionCreate', mockInteraction as unknown as ChatInputCommandInteraction);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(bindSpy).toHaveBeenCalledWith('123', 'my-folder');
    expect(mockInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Bound') }),
    );
  });

  test('should handle /new command', async () => {
    const prepareSessionSpy = spyOn(SessionManager.prototype, 'prepareSession').mockReturnValue(
      new OpenCodeAgent('test-session'),
    );
    const startSpy = spyOn(OpenCodeAgent.prototype, 'start').mockImplementation(async () => {});
    spies.push(prepareSessionSpy, startSpy);

    const client = new DiscordClient();
    const mockChannel = {
      id: 'channel-new-123',
      name: 'agent-1234',
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
          fetch: mock(async () => ({
            find: () => null,
          })),
        },
      },
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
    };

    client
      .getClient()
      .emit('interactionCreate', mockInteraction as unknown as ChatInputCommandInteraction);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockInteraction.guild.channels.create).toHaveBeenCalled();
    expect(prepareSessionSpy).toHaveBeenCalledWith('channel-new-123');
    expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
    expect(mockInteraction.editReply).toHaveBeenCalled();
  });
});
