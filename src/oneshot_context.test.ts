import { expect, test, describe, mock, spyOn, beforeEach } from 'bun:test';
import { DiscordClient } from './discord';
import { ChannelType, type TextChannel, type Message } from 'discord.js';
import { EventEmitter } from 'events';
import * as opencode from './opencode';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = 'oneshot_context_final_v3.test.json';

describe('One-Shot Context Persistence', () => {
  let client: DiscordClient;
  let mockChannel: EventEmitter;

  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = 'test-client-id';
    process.env.DISCORD_GUILD_ID = 'test-guild-id';
    process.env.SESSION_DB = TEST_DB;

    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }

    mockChannel = new EventEmitter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockChannel as any).id = 'channel-oneshot';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockChannel as any).send = mock(async () => ({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockChannel as any).type = ChannelType.GuildText;

    client = new DiscordClient();
  });

  test('should reuse stable sessionId for multiple oneshot messages', async () => {
    const discordClient = client.getClient();
    const sessionManager = client.getSessionManager();

    const stableSid = 'ses_oneshot_stable_123';
    sessionManager.prepareOneShotSession('channel-oneshot', stableSid);

    const capturedSessionIds: string[] = [];
    let resolveTurn: (() => void) | null = null;

    const startSpy = spyOn(opencode.OneShotOpenCodeProcess.prototype, 'start').mockImplementation(
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
    // Tiny delay to let the 'finally' block in discord.ts run and clear channelBusy
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(startSpy).toHaveBeenCalledTimes(1);
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
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(capturedSessionIds[1]).toBe(stableSid);

    startSpy.mockRestore();
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });
});
