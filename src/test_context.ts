import { spawn } from 'bun';

async function runOpencode(sessionId: string, prompt: string) {
  console.log(`\n--- Running with Session: ${sessionId} | Prompt: "${prompt}" ---`);
  const proc = spawn(
    ['/opt/homebrew/bin/opencode', 'run', '--format', 'json', '--session', sessionId, prompt],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const decoder = new TextDecoder();
  let fullOutput = '';

  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk);
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'text') {
          const content = event.part?.text || event.text;
          if (content) {
            process.stdout.write(content);
            fullOutput += content;
          }
        }
      } catch (_parseError) {
        // Skip non-json noise
      }
    }
  }

  const code = await proc.exited;
  console.log(`\nExited with code ${code}`);
  return fullOutput;
}

async function testContext() {
  // Turn 1: No session ID yet, capture it from output
  console.log('\n--- Turn 1: Starting fresh ---');
  const proc1 = spawn(
    ['/opt/homebrew/bin/opencode', 'run', '--format', 'json', 'My name is Thibaut. Remember this.'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const decoder = new TextDecoder();
  let sessionId = '';

  for await (const chunk of proc1.stdout) {
    const text = decoder.decode(chunk);
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const sid = event.sessionID || event.part?.sessionID;
        if (sid && !sessionId) {
          sessionId = sid;
          console.log(`Captured Session ID: ${sessionId}`);
        }
      } catch (_jsonError) {
        // Ignore
      }
    }
  }
  await proc1.exited;

  if (!sessionId) {
    console.log('❌ FAILURE: Could not capture session ID.');
    return;
  }

  // Turn 2: Use captured ID
  console.log(`\n--- Turn 2: Resuming session ${sessionId} ---`);
  const result = await runOpencode(sessionId, 'What is my name?');

  if (result.toLowerCase().includes('thibaut')) {
    console.log('\n✅ SUCCESS: Context preserved across turns using real session IDs!');
  } else {
    console.log('\n❌ FAILURE: Context lost.');
  }
}

testContext();
