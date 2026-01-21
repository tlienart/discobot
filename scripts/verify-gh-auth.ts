import { spawn } from 'bun';

/**
 * scripts/verify-gh-auth.ts
 *
 * Verifies that GH_TOKEN is correctly passed into the alcless sandbox.
 * Usage: GH_TOKEN=your_token bun scripts/verify-gh-auth.ts
 */

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('Error: GH_TOKEN environment variable is not set.');
    process.exit(1);
  }

  console.log('--- Verifying GH Auth in Sandbox ---');

  // We use alclessctl shell --plain default -- gh auth status
  // We first check if gh is available
  const checkGh = ['alclessctl', 'shell', '--plain', 'default', '--', 'which', 'gh'];

  console.log('Checking for gh CLI in sandbox...');
  const checkProc = spawn(checkGh, { stdout: 'pipe', stderr: 'pipe' });
  const checkExitCode = await checkProc.exited;

  if (checkExitCode !== 0) {
    console.log('gh CLI not found in sandbox. You may need to install it first:');
    console.log('  alclessctl shell default -- brew install gh');
    process.exit(1);
  }

  const command = ['alclessctl', 'shell', '--plain', 'default', '--', 'sh', '-c', 'gh auth status'];

  console.log(`Executing: ${command.join(' ')}`);

  const proc = spawn(command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      GH_TOKEN: token,
    },
  });

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    console.log('\nSuccess: GitHub CLI is authenticated inside the sandbox!');
  } else {
    console.error('\nError: GitHub CLI authentication failed.');
    console.error('Possible reasons:');
    console.error('1. alcless is not installed or configured.');
    console.error('2. gh CLI is not installed in the sandbox user environment.');
    console.error('3. GH_TOKEN is invalid.');
  }

  process.exit(exitCode);
}

main();
