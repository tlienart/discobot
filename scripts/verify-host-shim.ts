import { SandboxManager } from '../src/sandbox/manager';
import { spawn } from 'bun';
import { join } from 'path';
import { existsSync, mkdirSync, chmodSync } from 'fs';

async function main() {
  const workspace = '/Users/Shared/test-bridge-workspace';
  if (existsSync(workspace)) {
    // rm -rf
    await spawn(['rm', '-rf', workspace]).exited;
  }
  mkdirSync(workspace, { recursive: true });
  chmodSync(workspace, 0o777); // Ensure everyone can access

  const sandboxToken = process.env.SANDBOX_GH_TOKEN;
  if (!sandboxToken) {
    console.error('Error: SANDBOX_GH_TOKEN not found in environment.');
    process.exit(1);
  }

  const manager = new SandboxManager(workspace, sandboxToken);

  console.log('--- Testing Host Bridge & Dedicated Secret Isolation ---');
  console.log(`Using dedicated token: ${sandboxToken.substring(0, 15)}...`);

  await manager.start();
  const sandboxBin = join(workspace, '.bin');
  manager.setupShims(sandboxBin);

  // Set up a DIFFENT dummy GH_TOKEN for the host
  process.env.GH_TOKEN = 'host_primary_token_should_not_be_used';

  console.log('Running sandboxed gh command via shim...');

  // Simulate what a sandboxed process would do:
  // Use alclessctl to run the shim
  const cmd = [
    'alclessctl',
    'shell',
    '--plain',
    'default',
    '--',
    'sh',
    '-c',
    `export PATH="${sandboxBin}:$PATH"; gh auth status`,
  ];

  console.log(`Executing: ${cmd.join(' ')}`);

  const proc = spawn(cmd, {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;

  console.log(`\nExit code: ${exitCode}`);

  if (exitCode === 0) {
    console.log('Success: Bridge handled the request and returned output!');
  } else {
    console.log('Failed: Check bridge logs above.');
  }

  console.log('\nVerifying GH_TOKEN is NOT in sandbox environment...');
  const envCmd = [
    'alclessctl',
    'shell',
    '--plain',
    'default',
    '--',
    'sh',
    '-c',
    'env | grep GH_TOKEN || echo "GH_TOKEN not found (Good)"',
  ];
  await spawn(envCmd, { stdout: 'inherit', stderr: 'inherit' }).exited;

  manager.stop();
  process.exit(exitCode);
}

main();
