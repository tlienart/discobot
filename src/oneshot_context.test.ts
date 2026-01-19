import { expect, test, describe, mock, spyOn, beforeEach } from 'bun:test';
import { DiscordClient } from './discord';
import { ChannelType, type Message } from 'discord.js';
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

    const channel = new EventEmitter();
    // @ts-expect-error - mock setup
    channel.id = 'channel-oneshot';
    // @ts-expect-error - mock setup
    channel.send = mock(async () => ({}));
    // @ts-expect-error - mock setup
    channel.type = ChannelType.GuildText;
    mockChannel = channel as unknown as EventEmitter & {
      id: string;
      send: ReturnType<typeof mock>;
      type: ChannelType;
    };

    client = new DiscordClient();
  });

  test('should reuse stable sessionId for multiple oneshot messages', async () => {
    const discordClient = client.getClient();
    const sessionManager = client.getSessionManager();

    // 1. Manually prepare a session for a channel
    const stableSid = 'ses_oneshot_stable_123';
    sessionManager.prepareSession('channel-oneshot', stableSid);

    // 2. Spy on OpenCodeAgent start method
    const capturedSessionIds: string[] = [];
    const startSpy = spyOn(opencode.OpenCodeAgent.prototype, 'start').mockImplementation(
      async function (this: unknown) {
        const self = this as { sessionId?: string };
        capturedSessionIds.push(self.sessionId || '');
        return Promise.resolve();
      },
    );

    // 3. Simulate first message
    const mockMessage1 = {
      author: { bot: false },
      channelId: 'channel-oneshot',
      content: 'What time is it in Paris?',
      react: mock(async () => {}),
      channel: mockChannel,
      reply: mock(async () => {}),
    };

    // @ts-expect-error - mock message emission
    discordClient.emit('messageCreate', mockMessage1 as unknown as Message);

    // Robust wait for the spy to be called
    for (let i = 0; i < 100 && startSpy.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Check if start was called
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(capturedSessionIds[0]).toBe(stableSid);

    // 4. Simulate second message ("and in Oslo?")
    const mockMessage2 = {
      author: { bot: false },
      channelId: 'channel-oneshot',
      content: 'and in Oslo?',
      react: mock(async () => {}),
      channel: mockChannel,
      reply: mock(async () => {}),
    };

    // @ts-expect-error - mock message emission
    discordClient.emit('messageCreate', mockMessage2 as unknown as Message);

    // Robust wait for the second call
    for (let i = 0; i < 100 && startSpy.mock.calls.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

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
