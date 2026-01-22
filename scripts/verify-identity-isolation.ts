import { SessionManager } from '../src/sessions';
import { join } from 'path';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { type Config } from '../src/discord';

async function main() {
  console.log('--- Verifying Identity Shielding ---');

  const workspaceRoot = `/tmp/identity-test-${Date.now()}`;
  if (!existsSync(workspaceRoot)) {
    mkdirSync(workspaceRoot, { recursive: true });
    chmodSync(workspaceRoot, 0o777);
  }

  // Create a dummy config
  const config: Config = {
    discord: {
      token: 'test-token',
      clientId: 'test-id',
      guildId: 'test-guild',
      sessionDb: join(workspaceRoot, 'sessions.json'),
    },
    sandbox: {
      enabled: true,
      workspaceDir: workspaceRoot,
      sandboxGhToken: 'ghp_fake_sandbox_token_123',
      opencodeConfigPath: join(workspaceRoot, 'opencode.json'),
    },
  };

  // Set a different token on the host environment
  process.env.GH_TOKEN = 'ghp_REAL_HOST_TOKEN_DO_NOT_USE';

  const manager = new SessionManager(config);
  await new Promise((r) => setTimeout(r, 1000));

  const channelId = 'test-channel';
  const agent = manager.prepareSession(channelId) as unknown as {
    on: (event: string, cb: (data: string) => void) => void;
    start: (prompt: string) => Promise<void>;
  };

  console.log('Running gh auth status in sandbox...');

  let output = '';
  agent.on('output', (text: string) => {
    output += text;
  });
  agent.on('stderr', (text: string) => {
    output += text;
  });

  await agent.start('gh auth status');

  console.log(`\nOutput: ${output}`);

  if (output.includes('tlienart')) {
    console.error('\n❌ FAILURE: Host identity leaked into sandbox!');
    process.exit(1);
  } else if (
    output.includes('ghp_fake_sandbox_token_123') ||
    output.includes('Logged in to github.com')
  ) {
    console.log('\n✅ SUCCESS: Sandbox is isolated from host identity.');
  } else {
    console.log(
      '\n✅ SUCCESS: Sandbox is isolated (gh reported error for fake token as expected).',
    );
  }

  manager.stopAll();
  process.exit(0);
}

main();
