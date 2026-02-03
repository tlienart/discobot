import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import type { Config } from '../src/discord';
import type { OpenCodeEvent } from '../src/opencode';
import { SessionManager } from '../src/sessions';

async function main() {
  console.log('🚀 Starting Terminal Bot (Local Bridge Test)...');

  const configPath = join(process.cwd(), 'config.json');
  if (!existsSync(configPath)) {
    console.error('❌ Missing config.json');
    process.exit(1);
  }

  const config: Config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const manager = new SessionManager(config);

  const channelId = process.argv[2] || 'terminal-debug';
  console.log(`📡 Simulating channel: #${channelId}`);

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const prompt = await rl.question('\nUser > ');
      if (prompt.toLowerCase() === 'exit' || prompt.toLowerCase() === 'quit') break;

      const isDebug = process.env.BRIDGE_DEBUG === 'true';

      if (isDebug) {
        console.log(`[Bot] Spawning session for #${channelId}...`);
      } else {
        process.stdout.write('🚀 Starting agent...');
      }
      const session = manager.prepareSession(channelId);

      session.on('event', (event: OpenCodeEvent) => {
        if (event.type === 'tool_use' && isDebug) {
          console.log(`🛠️  Tool: ${event.part?.tool || event.tool}`);
        }
        if (event.type === 'error') {
          console.error(chalk.red(`❌ Error: ${event.error?.message || 'Unknown agent error'}`));
        }
        // Support bridge-level error messages
        if (event.type === 'error' && 'message' in event) {
          console.error(
            chalk.red(`❌ Bridge Error: ${String((event as { message?: string }).message)}`),
          );
        }
        if (event.type === 'step_start' && !isDebug) {
          process.stdout.write('\r                \r'); // Clear the "Starting agent..." line
        }
      });

      session.on('output', (text: string) => {
        process.stdout.write(`\nAgent > ${text}\n`);
      });

      session.on('stderr', (text: string) => {
        if (isDebug) {
          process.stderr.write(chalk.dim(text));
        }
      });

      session.on('thinking', (isThinking: boolean) => {
        if (isThinking) {
          process.stdout.write('⏳ Thinking...');
        } else {
          process.stdout.write(' ✅\n');
        }
      });

      session.on('exit', (code) => {
        console.log(`\n[Process exited with code ${code}]`);
        if (code === 1) {
          console.log(
            chalk.dim(
              '\n💡 Hint: If there was no output, the bridge might have failed to spawn the host process.',
            ),
          );
          console.log(
            chalk.dim('   Check the bridge logs at: /tmp/.sbx_<user>/bridge.log or trace.log'),
          );
        }
      });

      await session.start(prompt);
    }
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    rl.close();
    console.log('Stopping all sessions...');
    await manager.stopAll();
  }
}

main();
