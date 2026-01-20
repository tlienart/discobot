import { expect, test, describe, afterEach, beforeEach } from 'bun:test';
import { OpenCodeAgent } from './opencode';
import { existsSync, unlinkSync, mkdirSync, rmSync, readFileSync } from 'fs';

describe('OpenCodeAgent Sandbox Integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.USE_SANDBOX = 'true';
    process.env.GH_TOKEN = 'mock-gh-token';
    process.env.SECRET_TO_HIDE = 'dont-show-me';
    process.env.SANDBOX_WORKSPACE_DIR = './test-workspace';
    if (!existsSync('./test-workspace')) mkdirSync('./test-workspace');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (existsSync('.fence.json')) unlinkSync('.fence.json');
    if (existsSync('./test-workspace'))
      rmSync('./test-workspace', { recursive: true, force: true });
  });

  test('should construct correct environment with XDG overrides and pass-list', () => {
    const agent = new OpenCodeAgent('test-sid');
    const env = (agent as unknown as { getAgentEnv: () => Record<string, string> }).getAgentEnv();

    expect(env.GH_TOKEN).toBe('mock-gh-token');
    expect(env.SECRET_TO_HIDE).toBeUndefined();
    expect(env.XDG_DATA_HOME).toContain('test-workspace/.opencode/data');
    expect(env.XDG_CONFIG_HOME).toContain('test-workspace/.opencode/config');
  });

  test('should generate .fence.json with correct defaults', () => {
    const agent = new OpenCodeAgent('test-sid');
    const settingsPath = (
      agent as unknown as { generateFenceSettings: () => string }
    ).generateFenceSettings();

    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    expect(settings.network.allowedDomains).toContain('github.com');
    expect(settings.command.deny).toContain('rm -rf /');
    expect(settings.command.deny).toContain('git checkout main');
  });
});
