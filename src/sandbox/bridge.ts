import { listen, serve, type Socket, type SocketListener, type Server } from 'bun';
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
  private commandListener: SocketListener<unknown> | null = null;
  private proxyServer: Server<unknown> | null = null;
  private socketPath: string;
  private proxySocketPath: string;
  private sandboxToken?: string;
  private hostKeys: Record<string, string> = {};

  constructor(workspacePath: string, sandboxToken?: string, apiKeys?: Record<string, string>) {
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    this.socketPath = join(workspacePath, 'bridge.sock');
    this.proxySocketPath = join(workspacePath, 'proxy.sock');
    this.sandboxToken = sandboxToken;

    if (apiKeys) {
      this.hostKeys.google = apiKeys.google || '';
      this.hostKeys.openai = apiKeys.openai || '';
      this.hostKeys.anthropic = apiKeys.anthropic || '';
    }

    this.harvestHostKeys();
  }

  private harvestHostKeys() {
    // Fill in missing keys from host environment or auth.json
    if (!this.hostKeys.google) {
      this.hostKeys.google =
        process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
    }
    if (!this.hostKeys.openai) {
      this.hostKeys.openai = process.env.OPENAI_API_KEY || '';
    }
    if (!this.hostKeys.anthropic) {
      this.hostKeys.anthropic = process.env.ANTHROPIC_API_KEY || '';
    }

    const authPath = join(process.env.HOME || '', '.local/share/opencode/auth.json');
    if (existsSync(authPath)) {
      try {
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        if (!this.hostKeys.google) this.hostKeys.google = auth.google?.key;
        if (!this.hostKeys.openai) this.hostKeys.openai = auth.openai?.key;
        if (!this.hostKeys.anthropic) this.hostKeys.anthropic = auth.anthropic?.key;
      } catch (e) {
        // ignore
      }
    }
    console.log(
      `[Bridge] Harvested keys for providers: ${Object.entries(this.hostKeys)
        .filter(([_, v]) => !!v)
        .map(([k]) => k)
        .join(', ')}`,
    );
  }

  async start() {
    // 1. Command Bridge
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    this.commandListener = listen({
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
      },
    });
    chmodSync(this.socketPath, 0o777);

    // 2. API Proxy
    if (existsSync(this.proxySocketPath)) unlinkSync(this.proxySocketPath);
    const hostKeys = this.hostKeys;
    this.proxyServer = serve({
      unix: this.proxySocketPath,
      async fetch(req) {
        try {
          const url = new URL(req.url);
          let targetBase: string | null = null;
          let authHeader: string | null = null;
          let authValue: string | null = null;
          let isGoogle = false;

          if (url.pathname.startsWith('/google')) {
            let path = url.pathname.replace('/google', '');
            if (!path.startsWith('/v1beta')) path = '/v1beta' + path;
            targetBase = 'https://generativelanguage.googleapis.com' + path;
            authHeader = 'x-goog-api-key';
            authValue = hostKeys.google;
            isGoogle = true;
          } else if (url.pathname.startsWith('/openai')) {
            targetBase = 'https://api.openai.com' + url.pathname.replace('/openai', '');
            authHeader = 'Authorization';
            authValue = `Bearer ${hostKeys.openai}`;
          } else if (url.pathname.startsWith('/anthropic')) {
            targetBase = 'https://api.anthropic.com' + url.pathname.replace('/anthropic', '');
            authHeader = 'x-api-key';
            authValue = hostKeys.anthropic;
          }

          if (targetBase && authValue) {
            const finalUrl = new URL(targetBase + url.search);
            finalUrl.searchParams.delete('key');

            const headers = new Headers(req.headers);
            headers.delete('host');
            headers.delete('x-goog-api-key');
            headers.delete('authorization');
            headers.delete('x-api-key');

            if (isGoogle) finalUrl.searchParams.set('key', authValue);
            if (authHeader) headers.set(authHeader, authValue);

            const response = await fetch(finalUrl.toString(), {
              method: req.method,
              headers: headers,
              body: req.body,
              // @ts-expect-error - duplex
              duplex: 'half',
            });

            return response;
          }
          return new Response('Not Found', { status: 404 });
        } catch (e: any) {
          return new Response('Proxy Error: ' + e.message, { status: 502 });
        }
      },
    });
    chmodSync(this.proxySocketPath, 0o777);
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
      await Promise.all([proc.exited, stdoutReader, stderrReader]);
      socket.write(JSON.stringify({ type: 'exit', code: 0 }));
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
    this.commandListener?.stop();
    this.proxyServer?.stop();
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    if (existsSync(this.proxySocketPath)) unlinkSync(this.proxySocketPath);
  }

  getSocketPath() {
    return this.socketPath;
  }
  getProxySocketPath() {
    return this.proxySocketPath;
  }
}
