/* eslint-disable @typescript-eslint/no-explicit-any */
import { SessionManager } from '../src/sessions';
import { join } from 'path';
import { existsSync, rmSync, readFileSync } from 'fs';
import { spawn } from 'bun';

async function main() {
  console.log('--- standalone Sandbox Verification (Proxy + Config) ---');

  // Ensure environment is loaded or mocked
  if (!process.env.OPENCODE_CONFIG_PATH) {
    process.env.OPENCODE_CONFIG_PATH = join(
      process.env.HOME || '',
      '.config/opencode/opencode.json',
    );
  }

  const workspaceRoot = `/Users/Shared/sandbox-cli-test-${Date.now()}`;
  if (existsSync(workspaceRoot)) {
    // Bun's rmSync is recursive
    try {
      rmSync(workspaceRoot, { recursive: true, force: true });
    } catch (e) {
      console.warn('Could not clean workspace root:', e);
    }
  }

  process.env.SANDBOX_WORKSPACE_DIR = workspaceRoot;
  process.env.USE_SANDBOX = 'true';

  const manager = new SessionManager('test-cli-sessions.json');
  const channelId = 'cli-test-channel';

  console.log('1. Preparing session (Syncing config and starting bridge)...');
  const agent = manager.prepareSession(channelId) as unknown as {
    workspacePath: string;
    on: (event: string, cb: any) => void;
    start: (prompt: string) => Promise<void>;
  };

  // Wait a bit for the bridge to initialize
  await new Promise((r) => setTimeout(r, 1000));

  console.log('2. Verifying config sync...');
  const syncedConfigPath = join(agent.workspacePath, '.config/opencode/opencode.json');
  if (existsSync(syncedConfigPath)) {
    console.log('Success: Config synced to sandbox.');
  } else {
    console.error(`Failure: Config not found at ${syncedConfigPath}`);
    process.exit(1);
  }

  console.log('\n3. Running "whoami" in sandbox (Using real opencode + proxy)...');
  let output = '';
  agent.on('output', (text: string) => {
    output += text;
  });
  agent.on('event', (event: { type: string; part?: { tool?: string }; tool?: string }) => {
    if (event.type === 'tool_use') {
      console.log(`[Agent] Tool Use Detected: ${event.part?.tool || event.tool}`);
    }
  });

  agent.on('stderr', (text: string) => {
    console.error(`[Agent Stderr] ${text}`);
  });

  try {
    await agent.start('Execute the bash command "whoami" and tell me the result.');
  } catch (e) {
    console.error('Agent failed to start:', e);
  }

  console.log(`\nFinal Output: ${output}`);

  if (output.includes('alcless_')) {
    console.log('\n✅ Success: Agent ran as sandbox user and returned result!');
  } else {
    console.error('\n❌ Failure: Agent did not return expected output.');
    process.exit(1);
  }

  console.log('4. Verifying API Key is hidden...');
  const envProc = spawn(['alclessctl', 'shell', '--plain', 'default', 'env'], { stdout: 'pipe' });
  const envOutput = await new Response(envProc.stdout).text();

  if (envOutput.includes('API_KEY')) {
    console.error('❌ Failure: API_KEY leaked into sandbox environment!');
    process.exit(1);
  } else {
    console.log('✅ Success: No API keys found in sandbox environment.');
  }

  process.exit(0);
}

main();
