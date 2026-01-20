import { expect, test, describe, afterEach, beforeEach } from 'bun:test';
import { OpenCodeAgent } from './opencode';
import { existsSync, unlinkSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { resolve } from 'path';

describe('OpenCodeAgent Sandbox Integration', () => {
  const originalEnv = { ...process.env };
  const workspaceDir = resolve('./test-workspace');

  beforeEach(() => {
    process.env.USE_SANDBOX = 'true';
    process.env.GH_TOKEN = 'mock-gh-token';
    process.env.SECRET_TO_HIDE = 'dont-show-me';
    process.env.SANDBOX_WORKSPACE_DIR = workspaceDir;
    if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (existsSync('.fence.json')) unlinkSync('.fence.json');
    if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true, force: true });
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

  test('Fence should actually block access to .env', async () => {
    const agent = new OpenCodeAgent('test-real-fence-file');
    const settingsPath = (
      agent as unknown as { generateFenceSettings: () => string }
    ).generateFenceSettings();

    // We try to read the .env file from the root from within the workspace
    const proc = Bun.spawn(['fence', '--settings', settingsPath, '--', 'cat', '../.env'], {
      cwd: workspaceDir,
      stderr: 'pipe',
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    const stderrLower = stderr.toLowerCase();
    const isBlocked =
      stderrLower.includes('denied') || stderrLower.includes('operation not permitted');
    expect(isBlocked).toBe(true);
  });

  test('Fence should allow running whitelisted commands like git status', async () => {
    const agent = new OpenCodeAgent('test-real-fence-allowed');
    const settingsPath = (
      agent as unknown as { generateFenceSettings: () => string }
    ).generateFenceSettings();

    const proc = Bun.spawn(['fence', '--settings', settingsPath, '--', 'git', 'status'], {
      cwd: workspaceDir,
      stderr: 'pipe',
    });

    await proc.exited;
    // git status might fail because it's not a git repo, but it shouldn't be BLOCKED by fence
    const stderr = await new Response(proc.stderr).text();
    expect(stderr.toLowerCase()).not.toContain('blocked');
    expect(stderr.toLowerCase()).not.toContain('denied');
  });

  test('Fence should block forbidden commands like git push origin main', async () => {
    const agent = new OpenCodeAgent('test-real-fence-cmd');
    const settingsPath = (
      agent as unknown as { generateFenceSettings: () => string }
    ).generateFenceSettings();

    const proc = Bun.spawn(
      ['fence', '--settings', settingsPath, '--', 'git', 'push', 'origin', 'main'],
      {
        cwd: workspaceDir,
        stderr: 'pipe',
      },
    );

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(stderr.toLowerCase()).toContain('blocked');
  });

  test('Agent should pass whitelisted environment variables', async () => {
    const agent = new OpenCodeAgent('test-env-pass');
    process.env.GH_TOKEN = 'test-token-123';

    const env = (agent as unknown as { getAgentEnv: () => Record<string, string> }).getAgentEnv();
    expect(env.GH_TOKEN).toBe('test-token-123');

    const settingsPath = (
      agent as unknown as { generateFenceSettings: () => string }
    ).generateFenceSettings();

    // Run env command through fence to verify it's passed through
    const proc = Bun.spawn(['fence', '--settings', settingsPath, '--', 'env'], {
      cwd: workspaceDir,
      stdout: 'pipe',
      env: env,
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(stdout).toContain('GH_TOKEN=test-token-123');
    expect(stdout).toContain('XDG_DATA_HOME=');

    delete process.env.GH_TOKEN;
  });
});
