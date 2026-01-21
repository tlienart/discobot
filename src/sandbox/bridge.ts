import { listen } from 'bun';
import { spawn } from 'bun';
import { existsSync, unlinkSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';

export interface BridgeRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export class HostBridge {
  private listener: any = null;
  private socketPath: string;

  constructor(workspacePath: string) {
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    this.socketPath = join(workspacePath, 'bridge.sock');
  }

  async start() {
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    console.log(`[Bridge] Starting on ${this.socketPath}...`);

    this.listener = listen({
      unix: this.socketPath,
      socket: {
        data: async (socket, data) => {
          try {
            const request: BridgeRequest = JSON.parse(data.toString());
            await this.handleRequest(socket, request);
          } catch (error) {
            console.error('[Bridge] Error handling data:', error);
            socket.write(JSON.stringify({ type: 'error', message: String(error) }));
            socket.end();
          }
        },
        error: (socket, error) => {
          console.error('[Bridge] Socket error:', error);
        },
      },
    });

    // Ensure the socket is accessible by the sandbox user
    chmodSync(this.socketPath, 0o777);
  }

  private async handleRequest(socket: any, request: BridgeRequest) {
    console.log(
      `[Bridge] Executing: ${request.command} ${request.args.join(' ')} (cwd: ${request.cwd})`,
    );

    // Whitelist check
    const allowedCommands = ['gh', 'git'];
    if (!allowedCommands.includes(request.command)) {
      socket.write(
        JSON.stringify({ type: 'error', message: `Command ${request.command} not allowed` }),
      );
      socket.end();
      return;
    }

    const commandPath = request.command;

    try {
      const proc = spawn([commandPath, ...request.args], {
        // For now, let's use the current dir of the bridge if the requested cwd is invalid on host
        cwd: existsSync(request.cwd) ? request.cwd : process.cwd(),
        env: {
          ...process.env,
          ...request.env,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Stream stdout
      const stdoutReader = this.streamToSocket(proc.stdout, socket, 'stdout');
      // Stream stderr
      const stderrReader = this.streamToSocket(proc.stderr, socket, 'stderr');

      const exitCode = await proc.exited;
      await Promise.all([stdoutReader, stderrReader]);

      socket.write(JSON.stringify({ type: 'exit', code: exitCode }));
      socket.end();
    } catch (error) {
      console.error('[Bridge] Execution error:', error);
      socket.write(JSON.stringify({ type: 'error', message: String(error) }));
      socket.end();
    }
  }

  private async streamToSocket(stream: ReadableStream, socket: any, type: 'stdout' | 'stderr') {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        socket.write(JSON.stringify({ type, data: Buffer.from(value).toString('base64') }) + '\n');
      }
    } finally {
      reader.releaseLock();
    }
  }

  stop() {
    this.listener?.stop();
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
  }

  getSocketPath() {
    return this.socketPath;
  }
}
