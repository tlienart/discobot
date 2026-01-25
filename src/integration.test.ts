import { expect, test, describe, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { DiscordClient, type Config } from './discord';
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

const TEST_DB = 'integration.test.json';
const mockConfig: Config = {
  discord: {
    token: 'test-token',
    clientId: 'test-client-id',
    guildId: 'test-guild-id',
    sessionDb: TEST_DB,
  },
  sandbox: {
    enabled: false,
    workspaceDir: './workspace-test',
    sandboxGhToken: 'test-gh-token',
    opencodeConfigPath: './opencode.json',
  },
};

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
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
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
        fetch: mock(async () => ({
          get: () => null,
          find: () => null,
        })),
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

    client = new DiscordClient(mockConfig);

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

    client.getSessionManager().setCategoryId('987654321');
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
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
          if (name === 'name') return 'test-session';
          return null;
        },
      },
      guild: mockGuild,
      deferReply: mock(async () => {}),
      editReply: mock(async () => {}),
      reply: mock(async () => {}),
      channelId: 'cmd-integration-channel',
    };

    discordClient.emit(
      'interactionCreate',
      mockInteraction as unknown as ChatInputCommandInteraction,
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockGuild.channels.create).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();

    // Now simulate user sending a message in the newly created channel
    const mockMessage = {
      author: { bot: false },
      channelId: 'channel-integration-123',
      content: 'Hello agent!',
      react: mock(async () => {}),
      channel: mockChannel,
    };

    // @ts-expect-error - mock message emission
    discordClient.emit('messageCreate', mockMessage as Message);

    // Robust wait for start call
    for (let i = 0; i < 250 && mockProcess.start.mock.calls.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(mockProcess.start).toHaveBeenCalledWith('Hello agent!');
    expect(mockMessage.react).toHaveBeenCalledWith('📥');
  });
});
