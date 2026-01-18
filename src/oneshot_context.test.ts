import { expect, test, describe, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { DiscordClient } from './discord';
import { ChannelType, type TextChannel, type Message } from 'discord.js';
import { EventEmitter } from 'events';
import * as opencode from './opencode';
import { existsSync, unlinkSync } from 'fs';

describe('One-Shot Context Persistence', () => {
  let client: DiscordClient;
  let mockChannel: EventEmitter;
  let startSpy: unknown;

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = 'oneshot_context_final_v3.test.json';

    if (existsSync('oneshot_context_final_v3.test.json')) {
      unlinkSync('oneshot_context_final_v3.test.json');
    }

    mockChannel = new EventEmitter();
    // @ts-expect-error: mocking
    mockChannel.id = 'channel-oneshot';
    // @ts-expect-error: mocking
    mockChannel.send = mock(async () => ({}));
    // @ts-expect-error: mocking
    mockChannel.type = ChannelType.GuildText;

    client = new DiscordClient();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (startSpy) (startSpy as any).mockRestore();
    if (existsSync('oneshot_context_final_v3.test.json')) {
      unlinkSync('oneshot_context_final_v3.test.json');
    }
  });

  test('should reuse stable sessionId for multiple oneshot messages', async () => {
    const discordClient = client.getClient();
    const sessionManager = client.getSessionManager();

    const stableSid = 'ses_oneshot_stable_123';
    sessionManager.prepareOneShotSession('channel-oneshot', stableSid);

    const capturedSessionIds: string[] = [];
    let resolveTurn: (() => void) | null = null;

    startSpy = spyOn(opencode.OneShotOpenCodeProcess.prototype, 'start').mockImplementation(
      async function (this: opencode.OneShotOpenCodeProcess) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        capturedSessionIds.push((this as any).sessionId);
        if (resolveTurn) resolveTurn();
        return Promise.resolve();
      },
    );

    // Turn 1
    const mockMessage1 = {
      author: { bot: false },
      channelId: 'channel-oneshot',
      content: 'What time is it in Paris?',
      react: mock(async () => ({})),
      channel: mockChannel as unknown as TextChannel,
      reply: mock(async () => ({})),
    } as unknown as Message;

    const turn1Promise = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    discordClient.emit('messageCreate' as any, mockMessage1 as any);
    await turn1Promise;
    await new Promise((resolve) => setTimeout(resolve, 50));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(startSpy as any).toHaveBeenCalledTimes(1);
    expect(capturedSessionIds[0]).toBe(stableSid);

    // Turn 2
    const mockMessage2 = {
      author: { bot: false },
      channelId: 'channel-oneshot',
      content: 'and in Oslo?',
      react: mock(async () => ({})),
      channel: mockChannel as unknown as TextChannel,
      reply: mock(async () => ({})),
    } as unknown as Message;

    const turn2Promise = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    discordClient.emit('messageCreate' as any, mockMessage2 as any);
    await turn2Promise;
    await new Promise((resolve) => setTimeout(resolve, 50));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(startSpy as any).toHaveBeenCalledTimes(2);
    expect(capturedSessionIds[1]).toBe(stableSid);

    expect(mockMessage1.react).toHaveBeenCalledWith('📥');
    expect(mockMessage2.react).toHaveBeenCalledWith('📥');
  });
});
