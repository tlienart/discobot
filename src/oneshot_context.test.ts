import { expect, test, describe, mock, spyOn, beforeEach } from 'bun:test';
import { DiscordClient } from './discord';
import { ChannelType, type Message, type TextChannel } from 'discord.js';
import { EventEmitter } from 'events';
import * as opencode from './opencode';
import { existsSync, unlinkSync } from 'fs';

describe('One-Shot Context Persistence', () => {
  let client: DiscordClient;
  let mockChannel: EventEmitter & { id: string; send: ReturnType<typeof mock>; type: ChannelType };

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = 'oneshot_context.test.json';

    // @ts-expect-error: mocking
    mockChannel = new EventEmitter();
    mockChannel.id = 'channel-oneshot';
    mockChannel.send = mock(async () => ({}));
    mockChannel.type = ChannelType.GuildText;

    client = new DiscordClient();
  });

  test('should reuse stable sessionId for multiple oneshot messages', async () => {
    const discordClient = client.getClient();
    const sessionManager = client.getSessionManager();

    // 1. Manually prepare a oneshot session for a channel
    const stableSid = 'ses_oneshot_stable_123';
    sessionManager.prepareOneShotSession('channel-oneshot', stableSid);

    // 2. Spy on OneShotOpenCodeProcess constructor or start method
    const capturedSessionIds: (string | undefined)[] = [];
    const startSpy = spyOn(opencode.OneShotOpenCodeProcess.prototype, 'start').mockImplementation(
      async function (this: opencode.OneShotOpenCodeProcess) {
        // @ts-expect-error: accessing private sessionId
        capturedSessionIds.push(this.sessionId);
        return Promise.resolve();
      },
    );

    // 3. Simulate first message
    const mockMessage1 = {
      author: { bot: false },
      channelId: 'channel-oneshot',
      content: 'What time is it in Paris?',
      react: mock(async () => ({})),
      channel: mockChannel as unknown as TextChannel,
      reply: mock(async () => ({})),
    };

    // @ts-expect-error: mocking
    discordClient.emit('messageCreate', mockMessage1 as unknown as Message);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check if start was called
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(capturedSessionIds[0]).toBe(stableSid);

    // 4. Simulate second message ("and in Oslo?")
    const mockMessage2 = {
      author: { bot: false },
      channelId: 'channel-oneshot',
      content: 'and in Oslo?',
      react: mock(async () => ({})),
      channel: mockChannel as unknown as TextChannel,
      reply: mock(async () => ({})),
    };

    // @ts-expect-error: mocking
    discordClient.emit('messageCreate', mockMessage2 as unknown as Message);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(capturedSessionIds[1]).toBe(stableSid);

    expect(mockMessage1.react).toHaveBeenCalledWith('📥');
    expect(mockMessage2.react).toHaveBeenCalledWith('📥');

    startSpy.mockRestore();

    if (existsSync('oneshot_context.test.json')) {
      unlinkSync('oneshot_context.test.json');
    }
  });
});
