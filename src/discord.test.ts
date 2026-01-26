import { expect, test, describe, mock, spyOn, afterAll, afterEach } from 'bun:test';
import { DiscordClient, type Config } from './discord';
import { ChannelType, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { SessionManager } from './sessions';
import { OpenCodeAgent } from './opencode';
import { MockProcess } from './mock';
import { unlinkSync, existsSync, writeFileSync } from 'fs';

const TEST_DB = 'sessions.test.json';

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

describe('DiscordClient', () => {
  const spies: { mockRestore: () => void }[] = [];

  afterAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  test('should skip recovery for invalid Snowflake IDs', async () => {
    const dbData = { channels: { 'invalid-id': 'session-123' } };
    writeFileSync(TEST_DB, JSON.stringify(dbData));

    const client = new DiscordClient(mockConfig);
    const fetchSpy = spyOn(client.getClient().channels, 'fetch');
    spies.push(fetchSpy);

    await (client as unknown as { recoverSessions: () => Promise<void> }).recoverSessions();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.getSessionManager().getChannelMapping().has('invalid-id')).toBe(false);
  });

  test('should handle /setup command', async () => {
    const client = new DiscordClient(mockConfig);

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

    expect(client.getSessionManager().getCategoryId()).toBe('123456789');
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  test('should handle /new command', async () => {
    const prepareSessionSpy = spyOn(SessionManager.prototype, 'prepareSession').mockReturnValue(
      new OpenCodeAgent('test-session'),
    );
    spies.push(prepareSessionSpy);

    const client = new DiscordClient(mockConfig);
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
        getString: () => 'my-project',
      },
      guild: {
        channels: {
          create: mock(async () => mockChannel),
          fetch: mock(async () => ({
            get: () => null,
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
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockInteraction.guild.channels.create).toHaveBeenCalled();
    expect(prepareSessionSpy).toHaveBeenCalledWith('channel-new-123');
    expect(mockInteraction.editReply).toHaveBeenCalled();
  });

  test('should handle !mode shortcuts', async () => {
    const client = new DiscordClient(mockConfig);
    const mockMessage = {
      author: { bot: false },
      content: '!build create a file',
      channelId: 'chan-1',
      react: mock(async () => {}),
      reply: mock(async () => {}),
      channel: {
        id: 'chan-1',
        type: ChannelType.GuildText,
        send: mock(async () => {}),
        sendTyping: mock(async () => {}),
      },
    };

    const mockAgent = new MockProcess('test-session');
    const startSpy = spyOn(mockAgent, 'start');
    const prepareSessionSpy = spyOn(client.getSessionManager(), 'prepareSession').mockReturnValue(
      mockAgent as unknown as OpenCodeAgent,
    );
    spies.push(prepareSessionSpy);
    spies.push(startSpy);

    // @ts-expect-error - mock message emission
    client.getClient().emit('messageCreate', mockMessage as Message);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(client.getSessionManager().getMode('chan-1')).toBe('build');
    expect(mockMessage.reply).toHaveBeenCalledWith(
      expect.stringContaining('Mode set to **build**'),
    );
    expect(prepareSessionSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
  });
});
