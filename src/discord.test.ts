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

    client
      .getClient()
      .emit('interactionCreate', mockInteraction as unknown as ChatInputCommandInteraction);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(client.getCategoryId()).toBe('123456789');
    expect(mockInteraction.reply).toHaveBeenCalled();
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

    client
      .getClient()
      .emit('interactionCreate', mockInteraction as unknown as ChatInputCommandInteraction);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockInteraction.guild.channels.create).toHaveBeenCalled();
    expect(prepareSessionSpy).toHaveBeenCalledWith('channel-new-123');
    expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
    expect(startSpy).toHaveBeenCalledWith(
      expect.stringContaining('Instruction: Be concise and stay under 2000 chars'),
    );

    expect(mockInteraction.editReply).toHaveBeenCalled();
  });

  test('should handle /resume command', async () => {
    const prepareSessionSpy = spyOn(SessionManager.prototype, 'prepareSession').mockReturnValue(
      new OpenCodeAgent('test-session'),
    );
    const startSpy = spyOn(OpenCodeAgent.prototype, 'start').mockImplementation(async () => {});
    spies.push(prepareSessionSpy, startSpy);

    const client = new DiscordClient();
    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: 'resume',
      options: {
        getString: (name: string) => (name === 'session_id' ? 'ses_existing' : null),
      },
      channelId: 'chan-resume',
      channel: {
        id: 'chan-resume',
        send: mock(async () => {}),
      },
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
    };

    client
      .getClient()
      .emit('interactionCreate', mockInteraction as unknown as ChatInputCommandInteraction);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(prepareSessionSpy).toHaveBeenCalledWith('chan-resume', 'ses_existing');
    expect(startSpy).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
  });

  test('should handle /resume error when ID is missing', async () => {
    const client = new DiscordClient();
    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: 'resume',
      options: {
        getString: () => null,
      },
      reply: mock(async () => {}),
    };

    client
      .getClient()
      .emit('interactionCreate', mockInteraction as unknown as ChatInputCommandInteraction);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('provide a valid Session ID'),
      }),
    );
  });

  test('should handle messageCreate for input injection', async () => {
    const startSpy = mock(async () => {});
    const getSessionSpy = spyOn(SessionManager.prototype, 'getSession').mockImplementation(
      () =>
        ({
          start: startSpy,
        }) as unknown as OpenCodeAgent,
    );
    const getMappingSpy = spyOn(SessionManager.prototype, 'getChannelMapping').mockReturnValue(
      new Map([['channel-inject-123', 'ses_zebra']]),
    );
    const prepareSpy = spyOn(SessionManager.prototype, 'prepareSession').mockReturnValue({
      start: startSpy,
      on: mock(() => {}),
    } as unknown as OpenCodeAgent);
    spies.push(getSessionSpy, getMappingSpy, prepareSpy);

    const client = new DiscordClient();
    const mockMessage = {
      author: { bot: false },
      channelId: 'channel-inject-123',
      content: 'inject this',
      react: mock(async () => {}),
      channel: {
        id: 'channel-inject-123',
        send: mock(async () => {}),
      },
    };

    // @ts-expect-error - mock message emission
    client.getClient().emit('messageCreate', mockMessage as Message);

    // Robust wait for start call
    for (let i = 0; i < 250 && startSpy.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(getSessionSpy).toHaveBeenCalledWith('channel-inject-123');
    expect(prepareSpy).toHaveBeenCalledWith('channel-inject-123', 'ses_zebra');
    expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('inject this'));
    expect(startSpy).toHaveBeenCalledWith(
      expect.stringContaining('Instruction: Be concise and stay under 2000 chars'),
    );
  });
});
