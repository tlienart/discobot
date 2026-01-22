/* eslint-disable @typescript-eslint/no-explicit-any */
import { SessionManager } from '../src/sessions';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

async function runTurn(
  manager: SessionManager,
  channelId: string,
  prompt: string,
): Promise<string> {
  console.log(`\n[Turn] Prompt: "${prompt}"`);
  const agent = manager.prepareSession(channelId) as any;
  let fullOutput = '';

  agent.on('output', (text: string) => {
    fullOutput += text;
    process.stdout.write(text);
  });

  try {
    await agent.start(prompt);
  } catch (e) {
    console.error('Agent turn failed:', e);
  }

  return fullOutput;
}

async function main() {
  console.log('--- Stable Channel Flow Verification (Multi-Turn Context) ---');

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

  const workspaceRoot = `/Users/Shared/stable-flow-test-${Date.now()}`;
  process.env.USE_SANDBOX = 'true';
  process.env.OPENCODE_CONFIG_PATH = join(process.env.HOME || '', '.config/opencode/opencode.json');

  const config = JSON.parse(readFileSync('config.json', 'utf-8'));
  config.sandbox.workspaceDir = workspaceRoot;

  const manager = new SessionManager(config);
  const channelId = 'channel-stable-123';
  const channelName = 'test-project-alpha';

  console.log(`0. Binding channel to stable name: ${channelName}`);
  manager.bindChannelToFolder(channelId, channelName);

  // Wait for bridge to be ready
  await new Promise((r) => setTimeout(r, 2000));

  console.log('1. Starting Turn 1: Writing context file...');
  await runTurn(
    manager,
    channelId,
    'Execute the bash command "echo \'STABLE_CONTEXT_VERIFIED\' > context.txt" and confirm you did it.',
  );

  console.log('\n2. Starting Turn 2: Verifying context file exists...');
  const turn2Output = await runTurn(
    manager,
    channelId,
    'Read the file "context.txt" and tell me exactly what is inside in uppercase.',
  );

  console.log(`\n\nFinal Analysis:`);
  if (turn2Output.toUpperCase().includes('STABLE_CONTEXT_VERIFIED')) {
    console.log('\n✅ SUCCESS: Context correctly maintained in stable channel folder!');
  } else {
    console.error('\n❌ FAILURE: Turn 2 could not find or read what Turn 1 wrote.');
    process.exit(1);
  }

  process.exit(0);
}

main();
