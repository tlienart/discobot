import { SessionManager } from '../src/sessions';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';

async function main() {
  console.log('--- Verifying Workspace Binding Logic ---');

  const dbPath = 'test-sessions-binding.json';
  if (existsSync(dbPath)) rmSync(dbPath);

  const manager = new SessionManager(dbPath);
  const channelId = '123456789012345678';
  const folderName = 'verification-project';

  console.log(`1. Binding channel ${channelId} to folder "${folderName}"...`);
  const bound = manager.bindChannelToFolder(channelId, folderName);

  if (bound === folderName) {
    console.log('Success: Folder name sanitized and returned correctly.');
  } else {
    console.error('Failure: Unexpected sanitized name.');
    process.exit(1);
  }

  console.log('2. Preparing session for bound channel...');
  const agent = manager.prepareSession(channelId) as unknown as { workspacePath: string };

  const expectedPath = join(manager['workspacePath'], folderName);
  console.log(`Expected Workspace: ${expectedPath}`);
  console.log(`Actual Workspace:   ${agent.workspacePath}`);

  if (agent.workspacePath === expectedPath) {
    console.log('Success: Agent is using the bound folder.');
  } else {
    console.error('Failure: Agent is NOT using the bound folder.');
    process.exit(1);
  }

  if (existsSync(expectedPath)) {
    console.log('Success: Workspace folder was created on disk.');
  } else {
    console.error('Failure: Workspace folder was NOT created.');
    process.exit(1);
  }

  console.log('3. Verifying persistence of binding...');
  const manager2 = new SessionManager(dbPath);
  const bound2 = manager2.getBinding(channelId);

  if (bound2 === folderName) {
    console.log('Success: Binding persisted in sessions.json.');
  } else {
    console.error('Failure: Binding did NOT persist.');
    process.exit(1);
  }

  console.log('\n--- Verification Complete ---');
  if (existsSync(dbPath)) rmSync(dbPath);
  process.exit(0);
}

main();
