import { EventEmitter } from 'events';
import { spawn, type Subprocess } from 'bun';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { type Agent } from './agent';

export interface OpenCodeEvent {
  type: string;
  text?: string;
  sessionID?: string;
  tool?: string;
  error?: {
    message?: string;
    data?: {
      message?: string;
    };
  };
  part?: {
    type: string;
    text?: string;
    reason?: string;
    sessionID?: string;
    tool?: string;
    state?: {
      input?: unknown;
      output?: unknown;
      status?: string;
      error?: string;
    };
  };
}

export interface OpenCodeAgentOptions {
  workspacePath?: string;
  useSandbox?: boolean;
  sandboxBinDir?: string;
  entrypoint?: string;
  mode?: string;
  env?: Record<string, string>;
}

/**
 * OpenCode Agent: Spawns a new process for every turn (Stable Persistence).
 * Reuses the same session ID to preserve context via OpenCode's database.
 */
export class OpenCodeAgent extends EventEmitter implements Agent {
  private process: Subprocess | null = null;
  private buffer: string = '';
  private stdoutPath: string;
  private stderrPath: string;
  private lastActivity: number = Date.now();
  private heartbeatTimer: Timer | null = null;
  private workspacePath: string;
  private useSandbox: boolean;
  private sandboxBinDir?: string;
  private entrypoint?: string;
  private mode?: string;
  private extraEnv: Record<string, string>;

  constructor(
    private sessionId?: string,
    options: OpenCodeAgentOptions = {},
  ) {
    super();
    this.workspacePath = options.workspacePath || process.cwd();
    this.useSandbox = options.useSandbox || false;
    this.sandboxBinDir = options.sandboxBinDir;
    this.entrypoint = options.entrypoint;
    this.mode = options.mode;
    this.extraEnv = options.env || {};

    if (!existsSync('logs')) mkdirSync('logs');
    const logId = this.sessionId || `temp_${Date.now()}`;
    const turnId = Date.now();
    this.stdoutPath = `logs/agent_${logId}_${turnId}.stdout`;
    this.stderrPath = `logs/agent_${logId}_${turnId}.stderr`;
  }

  async start(prompt?: string) {
    const args = ['run', '--format', 'json', '--print-logs', '--log-level', 'DEBUG'];

    if (this.sessionId) {
      args.push('--session', this.sessionId);
    }

    if (this.mode) {
      args.push('--agent', this.mode);
    }

    if (prompt) {
      args.push(prompt);
    }

    const opencodeBinary = process.env.OPENCODE_BINARY || '/opt/homebrew/bin/opencode';

    let spawnArgs: string[];
    const spawnEnv = { ...process.env, ...this.extraEnv };

    if (this.useSandbox) {
      // Simplified command line using entrypoint script
      spawnArgs = [
        'alclessctl',
        'shell',
        '--plain',
        '--tty=false',
        '--workdir',
        this.workspacePath,
        'default',
        '--',
        '/bin/bash',
        this.entrypoint || './entrypoint.sh',
        opencodeBinary,
        ...args,
      ];
      console.log(`[Agent] Sandboxed Spawning: ${spawnArgs.join(' ')}`);
    } else {
      spawnArgs = [opencodeBinary, ...args];
      console.log(`[Agent] Spawning: ${spawnArgs.join(' ')}`);
    }

    try {
      this.process = spawn(spawnArgs, {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: null,
        env: spawnEnv,
      });

      console.log(`[Agent] PID: ${this.process.pid}`);
      this.startHeartbeat();

      const stdoutReader =
        this.process.stdout instanceof ReadableStream
          ? this.readStream(this.process.stdout, (data) => {
              this.handleChunk(data);
              writeFileSync(this.stdoutPath, data, { flag: 'a' });
            })
          : Promise.resolve();

      const stderrReader =
        this.process.stderr instanceof ReadableStream
          ? this.readStream(this.process.stderr, (data) => {
              this.emit('stderr', data);
              writeFileSync(this.stderrPath, data, { flag: 'a' });
            })
          : Promise.resolve();

      const [code] = await Promise.all([this.process.exited, stdoutReader, stderrReader]);
      console.log(`[Agent] PID ${this.process?.pid} exited with code ${code}`);

      this.stopHeartbeat();
      this.emit('exit', code);
    } catch (error) {
      console.error('[Agent] Failed to spawn:', error);
      this.stopHeartbeat();
      this.emit('error', error);
      throw error;
    }
  }

  private async readStream(stream: ReadableStream, callback: (data: string) => void) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.lastActivity = Date.now();
        callback(decoder.decode(value));
      }
    } catch (error) {
      console.error('[Agent Stream Reader Error]', error);
    } finally {
      reader.releaseLock();
    }
  }

  private startHeartbeat() {
    this.lastActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const inactiveSeconds = Math.floor((Date.now() - this.lastActivity) / 1000);
      if (inactiveSeconds >= 5) {
        this.emit('heartbeat', inactiveSeconds);
      }
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event: OpenCodeEvent = JSON.parse(line);
        this.processEvent(event);
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private processEvent(event: OpenCodeEvent) {
    this.lastActivity = Date.now();
    this.emit('event', event);

    if (event.type === 'text') {
      const text = event.part?.text || event.text;
      if (text) {
        this.emit('output', text);
      }
    } else if (event.type === 'step_start') {
      this.emit('thinking', true);
    } else if (event.type === 'step_finish') {
      const reason = event.part?.reason;
      this.emit('thinking', false);
      if (reason === 'stop') this.emit('idle');
    } else if (event.type === 'tool_use') {
      const toolName = event.part?.tool || event.tool;
      this.emit('tool_use', toolName);
    }
  }

  sendInput(_text: string) {
    console.warn('[Agent] Session is not interactive.');
  }

  async stop() {
    this.process?.kill();
    this.stopHeartbeat();
  }

  getPid() {
    return this.process?.pid;
  }
  getStdoutPath() {
    return this.stdoutPath;
  }
  getStderrPath() {
    return this.stderrPath;
  }
}
