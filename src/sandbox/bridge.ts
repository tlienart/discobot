import { listen, serve, type Socket, type SocketListener, type Server } from 'bun';
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
  private listener: SocketListener<unknown> | null = null;
  private proxyServer: Server<unknown> | null = null;
  private socketPath: string;
  private sandboxToken?: string;
  private proxyPort: number = 0;

  constructor(workspacePath: string, sandboxToken?: string) {
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    this.socketPath = join(workspacePath, 'bridge.sock');
    this.sandboxToken = sandboxToken;
  }

  async start() {
    // 1. Start Unix Socket Bridge
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    console.log(`[Bridge] Starting Unix bridge on ${this.socketPath}...`);

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

    chmodSync(this.socketPath, 0o777);

    // 2. Start API Proxy for LLM Providers
    this.proxyServer = serve({
      port: 0, // Random available port
      async fetch(req) {
        const url = new URL(req.url);
        let targetUrl: string | null = null;
        let authHeaderName: string | null = null;
        let authHeaderValue: string | null = null;

        // Detect Provider and set Target + Key
        if (url.pathname.startsWith('/google')) {
          targetUrl =
            'https://generativelanguage.googleapis.com' + url.pathname.replace('/google', '');
          authHeaderName = 'x-goog-api-key';
          authHeaderValue =
            process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '';
        } else if (url.pathname.startsWith('/openai')) {
          targetUrl = 'https://api.openai.com' + url.pathname.replace('/openai', '');
          authHeaderName = 'Authorization';
          authHeaderValue = `Bearer ${process.env.OPENAI_API_KEY || ''}`;
        } else if (url.pathname.startsWith('/anthropic')) {
          targetUrl = 'https://api.anthropic.com' + url.pathname.replace('/anthropic', '');
          authHeaderName = 'x-api-key';
          authHeaderValue = process.env.ANTHROPIC_API_KEY || '';
        }

        if (!targetUrl) {
          return new Response('Not Found or Unsupported Provider', { status: 404 });
        }

        console.log(`[Proxy] Forwarding ${url.pathname} -> ${targetUrl}`);

        const headers = new Headers(req.headers);
        headers.delete('host');
        if (authHeaderName && authHeaderValue) {
          headers.set(authHeaderName, authHeaderValue);
        }

        try {
          const response = await fetch(targetUrl + url.search, {
            method: req.method,
            headers: headers,
            body: req.body,
          });

          return response;
        } catch (error) {
          console.error('[Proxy] Forwarding error:', error);
          return new Response('Proxy Error', { status: 502 });
        }
      },
    });

    if (this.proxyServer) {
      this.proxyPort = (this.proxyServer.port as number) || 0;
      console.log(`[Bridge] API Proxy started on port ${this.proxyPort}`);
    }
  }

  private async handleRequest(socket: Socket<unknown>, request: BridgeRequest) {
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
      console.error('[Bridge] Execution error:', error);
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
    this.proxyServer?.stop();
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
  }

  getSocketPath() {
    return this.socketPath;
  }

  getProxyPort() {
    return this.proxyPort;
  }
}
