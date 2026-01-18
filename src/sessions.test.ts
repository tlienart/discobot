import { expect, test, describe, spyOn, afterAll, beforeEach } from 'bun:test';
import { SessionManager } from './sessions';
import { OpenCodeProcess } from './opencode';
import { MockProcess } from './mock';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = 'sessions_test_spec.json';

describe('SessionManager', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  afterAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test('should prepare and store sessions', async () => {
    const sm = new SessionManager(TEST_DB);
    const session = sm.prepareSession('channel-1');

    expect(sm.getSession('channel-1')).toBe(session);
    expect(session).toBeInstanceOf(OpenCodeProcess);
  });

  test('should prepare mock sessions', async () => {
    const sm = new SessionManager(TEST_DB);
    const session = sm.prepareMockSession('channel-mock');

    expect(sm.getSession('channel-mock')).toBe(session);
    expect(session).toBeInstanceOf(MockProcess);
  });

  test('should remove sessions', async () => {
    const stopSpy = spyOn(OpenCodeProcess.prototype, 'stop').mockImplementation(() =>
      Promise.resolve(),
    );

    const sm = new SessionManager(TEST_DB);
    sm.prepareSession('channel-1');
    sm.removeSession('channel-1');

    expect(sm.getSession('channel-1')).toBeUndefined();
    expect(stopSpy).toHaveBeenCalled();

    stopSpy.mockRestore();
  });

  test('should persist and load sessions', async () => {
    const sm1 = new SessionManager(TEST_DB);
    sm1.prepareSession('chan-1', 'ses_test-1');
    sm1.setCategoryId('cat-123');

    const sm2 = new SessionManager(TEST_DB);
    expect(sm2.getChannelMapping().get('chan-1')).toBe('ses_test-1');
    expect(sm2.getCategoryId()).toBe('cat-123');
  });

  test('should enforce prefixes', () => {
    const sm = new SessionManager(TEST_DB);
    sm.prepareSession('chan-prefix-test', 'my-session');
    // It should prefix with ses_
    expect(sm.getChannelMapping().get('chan-prefix-test')).toBe('ses_my-session');

    sm.prepareMockSession('chan-mock-test', 'mock-session');
    expect(sm.getChannelMapping().get('chan-mock-test')).toBe('ses_mock-session');
    
    sm.prepareOneShotSession('chan-oneshot-test', 'one-session');
    expect(sm.getChannelMapping().get('chan-oneshot-test')).toBe('ses_one-session');
  });
});
