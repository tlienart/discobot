import { expect, test, describe, spyOn, afterAll } from 'bun:test';
import { SessionManager } from './sessions';
import { OpenCodeAgent } from './opencode';
import { MockProcess } from './mock';
import { unlinkSync, existsSync } from 'fs';
import { type Config } from './discord';

const TEST_DB = 'sessions.test.json';
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
    ghToken: 'test-gh-token',
    opencodeConfigPath: './opencode.json',
  },
};

describe('SessionManager', () => {
  afterAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test('should prepare and store sessions', async () => {
    const sm = new SessionManager(mockConfig);
    const session = sm.prepareSession('channel-1');

    expect(sm.getSession('channel-1')).toBe(session);
    expect(session).toBeInstanceOf(OpenCodeAgent);
  });

  test('should prepare mock sessions', async () => {
    const sm = new SessionManager(mockConfig);
    const session = sm.prepareMockSession('channel-mock');

    expect(sm.getSession('channel-mock')).toBe(session);
    expect(session).toBeInstanceOf(MockProcess);
  });

  test('should remove sessions', async () => {
    const stopSpy = spyOn(OpenCodeAgent.prototype, 'stop').mockImplementation(() =>
      Promise.resolve(),
    );

    const sm = new SessionManager(mockConfig);
    sm.prepareSession('channel-1');
    sm.removeSession('channel-1');

    expect(sm.getSession('channel-1')).toBeUndefined();
    expect(stopSpy).toHaveBeenCalled();

    stopSpy.mockRestore();
  });

  test('should persist and load sessions', async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    const sm1 = new SessionManager(mockConfig);
    sm1.prepareSession('chan-1', 'ses_test-1');
    sm1.setCategoryId('cat-123');

    const sm2 = new SessionManager(mockConfig);
    expect(sm2.getChannelMapping().get('chan-1')).toBe('ses_test-1');
    expect(sm2.getCategoryId()).toBe('cat-123');
  });

  test('should enforce prefixes and generate animal names', () => {
    const sm = new SessionManager(mockConfig);
    sm.prepareSession('chan-prefix-test', 'zebra');
    expect(sm.getChannelMapping().get('chan-prefix-test')).toBe('ses_zebra');

    const sid = sm.generateBotSessionId();
    expect(sid).toMatch(/^[a-z]+$/);
  });

  test('should track session counts per channel', () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    const sm = new SessionManager(mockConfig);

    expect(sm.getCurrentSessionCount('chan-1')).toBe(1);
    expect(sm.getNextSessionCount('chan-1')).toBe(1);
    expect(sm.getNextSessionCount('chan-1')).toBe(2);
    expect(sm.getCurrentSessionCount('chan-1')).toBe(2);

    // Persistence
    const sm2 = new SessionManager(mockConfig);
    expect(sm2.getCurrentSessionCount('chan-1')).toBe(2);
    expect(sm2.getNextSessionCount('chan-1')).toBe(3);
  });
});
