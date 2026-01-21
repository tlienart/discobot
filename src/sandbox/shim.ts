import { connect } from 'bun';

async function main() {
  const socketPath = process.env.BRIDGE_SOCK || './workspace/bridge.sock';
  const command = process.env.SHIM_COMMAND || 'gh';
  const args = process.argv.slice(2);
  const cwd = process.cwd();

  console.error(`[Shim] Connecting to bridge at ${socketPath} for command ${command}...`);

  try {
    const socket = await connect({
      unix: socketPath,
      socket: {
        data(_socket, data) {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === 'stdout') {
                process.stdout.write(Buffer.from(msg.data, 'base64'));
              } else if (msg.type === 'stderr') {
                process.stderr.write(Buffer.from(msg.data, 'base64'));
              } else if (msg.type === 'exit') {
                process.exit(msg.code);
              } else if (msg.type === 'error') {
                console.error(`[Shim Error] ${msg.message}`);
                process.exit(1);
              }
            } catch {
              // Handle potential partial JSON or multiple messages
            }
          }
        },
        error(_socket, error) {
          console.error(`[Shim] Connection error: ${error}`);
          process.exit(1);
        },
        end(_socket) {
          // Connection closed
        },
      },
    });

    socket.write(
      JSON.stringify({
        command,
        args,
        cwd,
        env: {
          GH_TOKEN: process.env.GH_TOKEN, // In case it's needed, but ideally it's on host
        },
      }),
    );
  } catch (error) {
    console.error(`[Shim] Failed to connect to bridge: ${error}`);
    process.exit(1);
  }
}

main();
