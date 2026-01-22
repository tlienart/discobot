/* eslint-disable @typescript-eslint/no-explicit-any */
import { SessionManager } from '../src/sessions';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, unlinkSync } from 'fs';
import { spawn, listen } from 'bun';

async function stage1_socket() {
  console.log('\n--- STAGE 1: Socket Sanity ---');
  const sockPath = '/tmp/sandbox-ping.sock';
  if (existsSync(sockPath)) unlinkSync(sockPath);

  let receivedPing = false;
  const server = listen({
    unix: sockPath,
    socket: {
      data(socket, data) {
        if (data.toString().trim() === 'PING') {
          receivedPing = true;
          socket.write('PONG\n');
        }
      },
    },
  });
  chmodSync(sockPath, 0o777);

  console.log('Spawning sandbox to ping host socket...');
  const proc = spawn([
    'alclessctl',
    'shell',
    '--plain',
    'default',
    '--',
    'sh',
    '-c',
    `echo "PING" | nc -U ${sockPath}`,
  ]);

  // Timeout after 3s
  const timeout = setTimeout(() => proc.kill(), 3000);
  await proc.exited;
  clearTimeout(timeout);
  server.stop();

  if (receivedPing) {
    console.log('✅ STAGE 1 SUCCESS: Sandbox can reach host Unix sockets.');
  } else {
    console.error('❌ STAGE 1 FAILURE: Sandbox cannot reach host Unix sockets.');
    process.exit(1);
  }
}

async function stage2_tunnel(manager: SessionManager) {
  console.log('\n--- STAGE 2: Tunnel Sanity ---');
  const channelId = 'test-tunnel';
  const agent = manager.prepareSession(channelId) as any;

  // Wait for bridge
  await new Promise((r) => setTimeout(r, 1000));

  console.log('Spawning sandbox to test HTTP-to-Unix tunnel...');
  const proxyPort = readFileSync(join(agent.workspacePath, 'entrypoint.sh'), 'utf-8').match(
    /http_to_unix.py" (\d+)/,
  )?.[1];

  const cmd = [
    'alclessctl',
    'shell',
    '--plain',
    '--workdir',
    agent.workspacePath,
    'default',
    '--',
    '/bin/bash',
    './entrypoint.sh',
    'curl',
    '-v',
    `http://127.0.0.1:${proxyPort}/ping`,
  ];

  const proc = spawn(cmd, { stderr: 'pipe', stdout: 'pipe' });
  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (output.includes('Not Found') || stderr.includes('200')) {
    console.log('✅ STAGE 2 SUCCESS: HTTP traffic is reaching the host bridge.');
  } else {
    console.error('❌ STAGE 2 FAILURE: HTTP tunnel is broken.');
    console.error('Output:', output);
    console.error('Stderr:', stderr);
    process.exit(1);
  }
}

async function stage3_blind(manager: SessionManager) {
  console.log('\n--- STAGE 3: Blind Injection ---');
  const channelId = 'test-blind';
  const agent = manager.prepareSession(channelId) as any;
  await new Promise((r) => setTimeout(r, 1000));

  const proxyPort = readFileSync(join(agent.workspacePath, 'entrypoint.sh'), 'utf-8').match(
    /http_to_unix.py" (\d+)/,
  )?.[1];

  console.log('Testing real LLM request through blind proxy...');
  const cmd = [
    'alclessctl',
    'shell',
    '--plain',
    '--workdir',
    agent.workspacePath,
    'default',
    '--',
    '/bin/bash',
    './entrypoint.sh',
    'curl',
    '-v',
    `http://127.0.0.1:${proxyPort}/google/v1beta/models`,
  ];

  const proc = spawn(cmd);
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  if (output.includes('models/')) {
    console.log('✅ STAGE 3 SUCCESS: Real LLM keys injected successfully.');
  } else {
    console.error('❌ STAGE 3 FAILURE: LLM request failed.');
    console.error('Output:', output);
    process.exit(1);
  }
}

async function stage4_full(manager: SessionManager) {
  console.log('\n--- STAGE 4: Full Agent Cycle (120s Timeout) ---');
  const channelId = 'test-full';
  const agent = manager.prepareSession(channelId) as any;
  await new Promise((r) => setTimeout(r, 1000));

  console.log('Running real opencode agent...');
  let fullOutput = '';
  agent.on('output', (text: string) => {
    fullOutput += text;
    process.stdout.write(text);
  });

  agent.on('stderr', (text: string) => {
    process.stderr.write(`[Agent Stderr] ${text}`);
  });

  agent.on('event', (ev: any) => {
    if (ev.type === 'tool_use') {
      console.log(`\n[Agent] Using tool: ${ev.part?.tool || ev.tool}`);
    }
  });

  const agentPromise = agent.start(
    'Execute the bash command "whoami" and tell me exactly what it returned.',
  );
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Stage 4 timed out after 120 seconds')), 120000),
  );

  try {
    await Promise.race([agentPromise, timeoutPromise]);
  } catch (error: any) {
    console.error(`\n❌ STAGE 4 FAILURE: ${error.message}`);
    process.exit(1);
  }

  if (fullOutput.includes('alcless_')) {
    console.log('\n✅ STAGE 4 SUCCESS: Full end-to-end cycle complete!');
  } else {
    console.error('\n❌ STAGE 4 FAILURE: Agent finished but did not return the sandbox username.');
    console.log('Output received:', fullOutput);
    process.exit(1);
  }
}

async function main() {
  // Setup environment
  const authPath = join(process.env.HOME || '', '.local/share/opencode/auth.json');
  if (existsSync(authPath)) {
    const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
    process.env.GOOGLE_API_KEY = auth.google?.key;
  }

  process.env.USE_SANDBOX = 'true';
  process.env.OPENCODE_CONFIG_PATH = join(process.env.HOME || '', '.config/opencode/opencode.json');
  process.env.SANDBOX_WORKSPACE_DIR = `/tmp/sandbox-diagnostic-${Date.now()}`;
  console.log(`Diagnostic workspace: ${process.env.SANDBOX_WORKSPACE_DIR}`);

  const config = JSON.parse(readFileSync('config.json', 'utf-8'));
  config.sandbox.workspaceDir = process.env.SANDBOX_WORKSPACE_DIR;
  const manager = new SessionManager(config);

  await stage1_socket();
  await stage2_tunnel(manager);
  await stage3_blind(manager);
  await stage4_full(manager);

  console.log('\n🌟 ALL STAGES PASSED! The sandbox is robust.');
  process.exit(0);
}

main();
