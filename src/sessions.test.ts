import { expect, test, describe, spyOn, afterAll, beforeEach } from 'bun:test';
import { SessionManager } from './sessions';
import { OpenCodeProcess } from './opencode';
import { MockProcess } from './mock';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = 'sessions_final_v2.test.json';

describe('SessionManager', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  afterAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test('should prepare and store sessions', async () => {
    const sm = new SessionManager(TEST_DB);
    const session = sm.prepareSession('test-channel-1');

    const retrieved = sm.getSession('test-channel-1');
    expect(retrieved).toBeDefined();
    expect(retrieved).toBe(session);
    expect(session).toBeInstanceOf(OpenCodeProcess);
  });

  test('should prepare mock sessions', async () => {
    const sm = new SessionManager(TEST_DB);
    const session = sm.prepareMockSession('test-channel-mock');

    const retrieved = sm.getSession('test-channel-mock');
    expect(retrieved).toBeDefined();
    expect(retrieved).toBe(session);
    expect(session).toBeInstanceOf(MockProcess);
  });

  test('should remove sessions', async () => {
    const stopSpy = spyOn(OpenCodeProcess.prototype, 'stop').mockImplementation(() =>
      Promise.resolve(),
    );

    const sm = new SessionManager(TEST_DB);
    sm.prepareSession('test-channel-remove');
    sm.removeSession('test-channel-remove');

    expect(sm.getSession('test-channel-remove')).toBeUndefined();
    expect(stopSpy).toHaveBeenCalled();

    stopSpy.mockRestore();
  });

  test('should persist and load sessions', async () => {
    const sm1 = new SessionManager(TEST_DB);
    sm1.prepareSession('chan-persist', 'ses_val-1');
    sm1.setCategoryId('cat-persist');

    // Force a fresh manager to load from disk
    const sm2 = new SessionManager(TEST_DB);
    const mapping = sm2.getChannelMapping();
    expect(mapping.get('chan-persist')).toBe('ses_val-1');
    expect(sm2.getCategoryId()).toBe('cat-persist');
  });

  test('should enforce prefixes correctly', () => {
    const sm = new SessionManager(TEST_DB);

    sm.prepareSession('c1', 'no-prefix');
    expect(sm.getChannelMapping().get('c1')).toBe('ses_no-prefix');

    sm.prepareSession('c2', 'ses_already');
    expect(sm.getChannelMapping().get('c2')).toBe('ses_already');
  });

  test('should not store session ID for fresh opencode sessions until captured', () => {
    const sm = new SessionManager(TEST_DB);
    sm.prepareSession('fresh-channel');
    expect(sm.getChannelMapping().get('fresh-channel')).toBeUndefined();

    sm.prepareOneShotSession('fresh-oneshot');
    expect(sm.getChannelMapping().get('fresh-oneshot')).toBeUndefined();
  });

  test('should store session ID for mock sessions immediately', () => {
    const sm = new SessionManager(TEST_DB);
    sm.prepareMockSession('mock-channel');
    expect(sm.getChannelMapping().get('mock-channel')).toBeDefined();
    expect(sm.getChannelMapping().get('mock-channel')).toMatch(/^ses_/);
  });
});
