import { OpenCodeAgent } from '../src/opencode';
import { join } from 'path';
import { existsSync, mkdirSync, chmodSync, copyFileSync, writeFileSync } from 'fs';
import { HostBridge } from '../src/sandbox/bridge';

async function main() {
  console.log('--- Verifying Full Integration (Real OpenCode in Sandbox) ---');

  const workspaceRoot = '/Users/Shared/opencode-full-test';
  if (!existsSync(workspaceRoot)) {
    mkdirSync(workspaceRoot, { recursive: true });
    chmodSync(workspaceRoot, 0o777);
  }

  const sessionId = 'ses_full_test_panda';
  const sessionWorkspace = join(workspaceRoot, sessionId);
  if (!existsSync(sessionWorkspace)) {
    mkdirSync(sessionWorkspace);
    chmodSync(sessionWorkspace, 0o777);
  }

  const binDir = join(workspaceRoot, '.bin');
  if (!existsSync(binDir)) {
    mkdirSync(binDir);
    chmodSync(binDir, 0o777);
  }

  // Create real shims
  console.log('Creating shims...');
  const shimPyPath = join(process.cwd(), 'src/sandbox/shim.py');
  const targetShimPy = join(binDir, 'shim.py');
  copyFileSync(shimPyPath, targetShimPy);
  chmodSync(targetShimPy, 0o755);

  const tools = ['gh', 'git'];
  const socketPath = join(workspaceRoot, 'bridge.sock');
  for (const tool of tools) {
    const shimPath = join(binDir, tool);
    writeFileSync(
      shimPath,
      `#!/bin/bash\nBRIDGE_SOCK="${socketPath}" SHIM_COMMAND="${tool}" /usr/bin/python3 "${targetShimPy}" "$@"\n`,
    );
    chmodSync(shimPath, 0o755);
  }

  // Start the bridge on the host
  const bridge = new HostBridge(workspaceRoot, process.env.SANDBOX_GH_TOKEN);
  await bridge.start();

  const agent = new OpenCodeAgent(undefined, {
    workspacePath: sessionWorkspace,
    useSandbox: true,
    sandboxBinDir: binDir,
  });

  let output = '';
  agent.on('output', (text) => {
    output += text;
  });
  agent.on('stderr', (text) => {
    console.error(`[OpenCode Stderr] ${text}`);
  });

  console.log('Testing Real OpenCode with shims (git status)...');
  await agent.start('git status');
  console.log(`Output: ${output}`);

  if (output.toLowerCase().includes('not a git repository')) {
    console.log('\n✅ Success: Real OpenCode used the git shim!');
  } else {
    console.error('\n❌ Failure: Git shim was not correctly used or returned unexpected output.');
    process.exit(1);
  }

  bridge.stop();
  process.exit(0);
}

main();
