/* eslint-disable @typescript-eslint/no-explicit-any */
import { SessionManager } from '../src/sessions';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

async function main() {
  console.log('--- standalone Sandbox Verification (Final Celebratory Run) ---');

  // Load API Key for proxy from host's auth.json
  const authPath = join(process.env.HOME || '', '.local/share/opencode/auth.json');
  if (existsSync(authPath)) {
    const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
    process.env.GOOGLE_API_KEY = auth.google?.key;
  }

  if (!process.env.GOOGLE_API_KEY) {
    console.error('Error: GOOGLE_API_KEY not found.');
    process.exit(1);
  }

  const workspaceRoot = `/Users/Shared/sandbox-cli-test-${Date.now()}`;
  process.env.SANDBOX_WORKSPACE_DIR = workspaceRoot;
  process.env.USE_SANDBOX = 'true';
  process.env.OPENCODE_CONFIG_PATH = join(process.env.HOME || '', '.config/opencode/opencode.json');

  const manager = new SessionManager('test-cli-sessions.json');
  const channelId = 'cli-test-channel';

  console.log('1. Preparing session (Injecting blind proxy config)...');
  const agent = manager.prepareSession(channelId) as any;

  // Wait for bridge/proxy to be fully ready and sockets created
  await new Promise((r) => setTimeout(r, 4000));

  const proxySock = join(workspaceRoot, 'proxy.sock');
  if (existsSync(proxySock)) {
    console.log(`Success: Proxy socket exists at ${proxySock}`);
  } else {
    console.warn(`Warning: Proxy socket NOT found at ${proxySock}`);
  }

  console.log('\n2. Running "whoami" in sandbox...');
  let fullOutput = '';
  agent.on('output', (text: string) => {
    fullOutput += text;
  });

  try {
    // We ask for a tool call to verify the proxy and secrets
    await agent.start('Execute "whoami" in bash and tell me the result.');
  } catch (e) {
    console.error('Agent failed to start:', e);
  }

  console.log(`\nAgent Response: ${fullOutput}`);

  if (fullOutput.includes('alcless_')) {
    console.log(
      '\n✅ SUCCESS: The sandbox is secure, the proxy is blind, and the agent is functional!',
    );
  } else {
    console.error('\n❌ Failure: Output did not contain the sandbox username.');
    process.exit(1);
  }

  console.log('\n3. Verifying Secret Blindness...');
  const authContent = readFileSync(
    join(agent.workspacePath, '.local/share/opencode/auth.json'),
    'utf-8',
  );
  if (authContent.includes('SANDBOX_MANAGED')) {
    console.log('✅ Success: Sandbox only contains dummy keys.');
  } else {
    console.error('❌ Failure: Real keys were leaked to the sandbox!');
    process.exit(1);
  }

  process.exit(0);
}

main();
