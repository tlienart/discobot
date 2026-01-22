import { listen, type Socket, type SocketListener } from 'bun';
import { spawn } from 'bun';
import { existsSync, unlinkSync, mkdirSync, chmodSync, readFileSync } from 'fs';
import { join } from 'path';

export interface BridgeRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export class HostBridge {
  private listener: SocketListener<unknown> | null = null;
  private socketPath: string;
  private workspacePath: string;
  private sandboxToken?: string;
  private hostKeys: Record<string, string> = {};

  constructor(workspacePath: string, sandboxToken?: string) {
    this.workspacePath = workspacePath;
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    chmodSync(workspacePath, 0o777);
    this.socketPath = join(workspacePath, 'bridge.sock');
    this.sandboxToken = sandboxToken;
    this.harvestHostKeys();
  }

  private harvestHostKeys() {
    const authPath = join(process.env.HOME || '', '.local/share/opencode/auth.json');
    if (existsSync(authPath)) {
      try {
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        if (auth.google?.key) this.hostKeys.google = auth.google.key;
        if (auth.openai?.key) this.hostKeys.openai = auth.openai.key;
        if (auth.anthropic?.key) this.hostKeys.anthropic = auth.anthropic.key;
      } catch (e) {
        // Ignore
      }
    }
  }

  async start() {
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);

    this.listener = listen({
      unix: this.socketPath,
      socket: {
        data: async (socket, data) => {
          try {
            const request: BridgeRequest = JSON.parse(data.toString());
            await this.handleRequest(socket, request);
          } catch (error) {
            socket.write(JSON.stringify({ type: 'error', message: String(error) }));
            socket.end();
          }
        },
      },
    });
    chmodSync(this.socketPath, 0o777);
    console.log(`[Bridge] Started on ${this.socketPath}`);
  }

  private async handleRequest(socket: Socket<unknown>, request: BridgeRequest) {
    const allowedCommands = ['gh', 'git'];
    if (!allowedCommands.includes(request.command)) {
      socket.write(
        JSON.stringify({ type: 'error', message: `Command ${request.command} not allowed` }),
      );
      socket.end();
      return;
    }

    try {
      const proc = spawn([request.command, ...request.args], {
        cwd: existsSync(request.cwd) ? request.cwd : process.cwd(),
        env: {
          ...process.env,
          ...request.env,
          GH_TOKEN: this.sandboxToken || process.env.SANDBOX_GH_TOKEN || process.env.GH_TOKEN,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdoutReader = this.streamToSocket(proc.stdout, socket, 'stdout');
      const stderrReader = this.streamToSocket(proc.stderr, socket, 'stderr');

      const exitCode = await proc.exited;
      await Promise.all([stdoutReader, stderrReader]);

      socket.write(JSON.stringify({ type: 'exit', code: exitCode }));
      socket.end();
    } catch (error) {
      socket.write(JSON.stringify({ type: 'error', message: String(error) }));
      socket.end();
    }
  }

  private async streamToSocket(
    stream: ReadableStream,
    socket: Socket<unknown>,
    type: 'stdout' | 'stderr',
  ) {
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
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
  }

  getSocketPath() {
    return this.socketPath;
  }
}
