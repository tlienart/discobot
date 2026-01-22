/* eslint-disable @typescript-eslint/no-explicit-any */
import { SessionManager } from '../src/sessions';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

async function runTurn(
  manager: SessionManager,
  channelId: string,
  prompt: string,
  sessionId?: string,
): Promise<{ output: string; sessionId: string }> {
  console.log(`\n[Turn] Prompt: "${prompt}" (Session ID: ${sessionId || 'new'})`);
  const agent = manager.prepareSession(channelId, sessionId) as any;
  let fullOutput = '';
  let discoveredSid = '';

  agent.on('output', (text: string) => {
    fullOutput += text;
    process.stdout.write(text);
  });

  agent.on('event', (event: any) => {
    const sid = event.sessionID || event.part?.sessionID;
    if (sid) discoveredSid = sid;
  });

  try {
    await agent.start(prompt);
  } catch (e) {
    console.error('Agent turn failed:', e);
  }

  return { output: fullOutput, sessionId: discoveredSid };
}

async function main() {
  console.log('--- Multi-Turn Session Verification (Blind Sandbox) ---');

  // Load API Key for proxy
  const authPath = join(process.env.HOME || '', '.local/share/opencode/auth.json');
  if (existsSync(authPath)) {
    const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
    process.env.GOOGLE_API_KEY = auth.google?.key;
  }

  if (!process.env.GOOGLE_API_KEY) {
    console.error('Error: GOOGLE_API_KEY not found.');
    process.exit(1);
  }

  const workspaceRoot = `/Users/Shared/session-test-${Date.now()}`;
  process.env.SANDBOX_WORKSPACE_DIR = workspaceRoot;
  process.env.USE_SANDBOX = 'true';
  process.env.OPENCODE_CONFIG_PATH = join(process.env.HOME || '', '.config/opencode/opencode.json');

  const manager = new SessionManager('test-multi-sessions.json');
  const channelId = 'multi-turn-channel';
  const stableFolder = 'persistent-test-session';

  console.log(`0. Binding channel to stable folder: ${stableFolder}`);
  manager.bindChannelToFolder(channelId, stableFolder);

  // Wait for manager to initialize bridge
  await new Promise((r) => setTimeout(r, 2000));

  console.log('1. Starting Turn 1...');
  const turn1 = await runTurn(manager, channelId, "use bash tool 'whoami'");

  const sid = turn1.sessionId;

  if (!sid) {
    console.error('Failure: No Session ID captured in Turn 1');
    process.exit(1);
  }
  console.log(`\nCaptured Session ID: ${sid}`);

  // Give some breathing room
  await new Promise((r) => setTimeout(r, 2000));

  console.log('\n2. Starting Turn 2 (Context Check)...');
  const turn2 = await runTurn(
    manager,
    channelId,
    'what was the previous result? tell me exactly what it was in uppercase.',
    sid,
  );

  console.log(`\n\nFinal Analysis:`);
  console.log(`Turn 1 Result: ${turn1.output.trim()}`);
  console.log(`Turn 2 Result: ${turn2.output.trim()}`);

  if (turn2.output.toUpperCase().includes('ALCLESS_')) {
    console.log('\n✅ SUCCESS: Context correctly maintained across process restarts!');
  } else {
    console.error('\n❌ FAILURE: Agent lost context of the previous turn.');
    process.exit(1);
  }

  process.exit(0);
}

main();
