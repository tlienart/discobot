import { listen, spawn, type Socket, type SocketListener } from 'bun';
import { existsSync, unlinkSync, mkdirSync, chmodSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import https from 'https';

export interface BridgeRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export class HostBridge {
  private commandListener: SocketListener<unknown> | null = null;
  private proxyServer: http.Server | null = null;
  private socketPath: string;
  private proxySocketPath: string;
  private workspacePath: string;
  private sandboxToken?: string;
  private hostKeys: Record<string, string> = {};

  constructor(workspacePath: string, sandboxToken?: string, apiKeys?: Record<string, string>) {
    this.workspacePath = workspacePath;
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
        const authText = readFileSync(authPath, 'utf-8');
        const auth = JSON.parse(authText);
        if (!this.hostKeys.google) this.hostKeys.google = auth.google?.key;
        if (!this.hostKeys.openai) this.hostKeys.openai = auth.openai?.key;
        if (!this.hostKeys.anthropic) this.hostKeys.anthropic = auth.anthropic?.key;
      } catch {
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

    this.proxyServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

        if (url.pathname === '/ping') {
          res.writeHead(200);
          res.end('PONG');
          return;
        }

        let targetHost: string | null = null;
        let targetPath: string | null = null;
        let authHeader: string | null = null;
        let authValue: string | null = null;
        let isGoogle = false;

        if (url.pathname.startsWith('/google')) {
          let path = url.pathname.replace('/google', '');
          if (!path.startsWith('/v1beta')) path = '/v1beta' + path;
          targetHost = 'generativelanguage.googleapis.com';
          targetPath = path;
          authHeader = 'x-goog-api-key';
          authValue = hostKeys.google;
          isGoogle = true;
        } else if (url.pathname.startsWith('/openai')) {
          targetHost = 'api.openai.com';
          targetPath = url.pathname.replace('/openai', '');
          authHeader = 'Authorization';
          authValue = `Bearer ${hostKeys.openai}`;
        } else if (url.pathname.startsWith('/anthropic')) {
          targetHost = 'api.anthropic.com';
          targetPath = url.pathname.replace('/anthropic', '');
          authHeader = 'x-api-key';
          authValue = hostKeys.anthropic;
        }

        if (targetHost && authValue) {
          const finalPath = targetPath + url.search;
          const finalUrl = new URL(`https://${targetHost}${finalPath}`);
          if (isGoogle) finalUrl.searchParams.set('key', authValue);

          const proxyReq = https.request(
            {
              hostname: targetHost,
              port: 443,
              path: finalUrl.pathname + finalUrl.search,
              method: req.method,
              headers: {
                ...req.headers,
                host: targetHost,
                [authHeader.toLowerCase()]: authValue,
              },
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              proxyRes.pipe(res);
            },
          );

          proxyReq.on('error', (e) => {
            console.error(`[Proxy] Upstream error: ${e.message}`);
            res.writeHead(502);
            res.end('Proxy Error');
          });

          req.pipe(proxyReq);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch (error) {
        console.error('[Proxy] Internal error:', error);
        res.writeHead(500);
        res.end('Internal Error');
      }
    });

    this.proxyServer.listen(this.proxySocketPath, () => {
      console.log(`[Bridge] API Proxy listening on ${this.proxySocketPath}`);
      chmodSync(this.proxySocketPath, 0o777);
    });

    // Wait for sockets to exist
    for (let i = 0; i < 10; i++) {
      if (existsSync(this.socketPath) && existsSync(this.proxySocketPath)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
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

    const commandPath = request.command;
    const isolatedHome = join(this.workspacePath, '.isolated_home');
    if (!existsSync(isolatedHome)) {
      mkdirSync(isolatedHome, { recursive: true });
    }

    try {
      const proc = spawn([commandPath, ...request.args], {
        cwd: existsSync(request.cwd) ? request.cwd : process.cwd(),
        env: {
          ...process.env,
          HOME: isolatedHome,
          GH_CONFIG_DIR: join(isolatedHome, '.config', 'gh'),
          GH_TOKEN: this.sandboxToken || '',
          GITHUB_TOKEN: this.sandboxToken || '',
          GITHUB_USER: '',
          GH_USER: '',
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
    this.proxyServer?.close();
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
