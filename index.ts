import { DiscordClient } from './src/discord';

async function main() {
  try {
    const discord = new DiscordClient();
    await discord.registerCommands();
    await discord.login();

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down...');
      await discord.getSessionManager().stopAll();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start the bridge:', error);
    process.exit(1);
  }
}

main();
