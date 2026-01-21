import { OpenCodeAgent } from '../src/opencode';
import { join } from 'path';
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from 'fs';

async function main() {
  console.log('--- Verifying Discord-Sandbox Integration with Dumb Shell ---');

  const workspaceRoot = '/Users/Shared/workspace-test';
  if (existsSync(workspaceRoot)) {
    // Just ensure it's clean-ish
    chmodSync(workspaceRoot, 0o777);
  } else {
    mkdirSync(workspaceRoot, { recursive: true });
    chmodSync(workspaceRoot, 0o777);
  }

  const sessionId = 'test-animal-panda';
  const sessionWorkspace = join(workspaceRoot, sessionId);
  if (!existsSync(sessionWorkspace)) {
    mkdirSync(sessionWorkspace);
    chmodSync(sessionWorkspace, 0o777);
  }

  // Path to our dumb shell wrapper
  const binDir = join(workspaceRoot, '.bin');
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    chmodSync(binDir, 0o777);
  }

  const dumbShellPath = join(binDir, 'opencode');
  const sourceShellPath = join(process.cwd(), 'scripts/dumb-opencode.sh');
  const scriptContent = readFileSync(sourceShellPath);
  writeFileSync(dumbShellPath, scriptContent);
  chmodSync(dumbShellPath, 0o755);

  process.env.OPENCODE_BINARY = dumbShellPath;

  const agent = new OpenCodeAgent(sessionId, {
    workspacePath: sessionWorkspace,
    useSandbox: true,
    sandboxBinDir: binDir,
  });

  console.log('1. Testing basic command execution (whoami)...');
  let output = '';
  agent.on('output', (text) => {
    output += text;
  });
  agent.on('stderr', (text) => {
    console.error(`[Agent Stderr] ${text}`);
  });

  await agent.start('whoami');

  console.log(`Output: ${output}`);
  if (output.includes('alcless_')) {
    console.log('Success: Running as sandbox user.');
  } else {
    console.error('Failure: Not running as sandbox user.');
    process.exit(1);
  }

  console.log('\n2. Testing workspace mapping (pwd)...');
  output = '';
  await agent.start('pwd');
  console.log(`Output: ${output}`);
  if (output.includes(sessionId)) {
    console.log('Success: CWD is in the session workspace.');
  } else {
    console.error('Failure: CWD is incorrect.');
    process.exit(1);
  }

  console.log('\n3. Testing persistence and write access...');
  await agent.start('echo "Persisted Content" > verified.txt');

  // Check on host if file exists
  const hostFilePath = join(sessionWorkspace, 'verified.txt');
  if (existsSync(hostFilePath)) {
    const content = readFileSync(hostFilePath, 'utf-8');
    console.log(`Success: File created on host at ${hostFilePath}`);
    console.log(`Content: ${content.trim()}`);
  } else {
    console.error('Failure: File was not created in workspace.');
    process.exit(1);
  }

  console.log('\n--- Verification Complete ---');
  process.exit(0);
}

main();
