import { EventEmitter } from 'events';
import { spawn, type Subprocess } from 'bun';
import { writeFileSync, existsSync, mkdirSync, realpathSync } from 'fs';
import { type Agent } from './agent';
import { join } from 'path';

export interface OpenCodeEvent {
  type: string;
  text?: string;
  sessionID?: string;
  tool?: string;
  part?: {
    type: string;
    text?: string;
    reason?: string;
    sessionID?: string;
    tool?: string;
    state?: {
      input?: unknown;
      output?: unknown;
    };
  };
}

const ENV_PASS_LIST = [
  'GH_TOKEN',
  'GCLOUD_PROJECT',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'PATH',
  'HOME',
  'USER',
  'LANG',
];

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

  constructor(private sessionId?: string) {
    super();
    if (!existsSync('logs')) mkdirSync('logs');
    const logId = this.sessionId || `temp_${Date.now()}`;
    const turnId = Date.now();
    this.stdoutPath = `logs/agent_${logId}_${turnId}.stdout`;
    this.stderrPath = `logs/agent_${logId}_${turnId}.stderr`;
  }

  private getAgentEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    // 1. Pass whitelisted secrets
    for (const key of ENV_PASS_LIST) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }

    // 2. Add XDG overrides for sandbox isolation
    const workspace = process.env.SANDBOX_WORKSPACE_DIR || './workspace';
    if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });
    const absWorkspace = realpathSync(workspace);

    env.XDG_DATA_HOME = join(absWorkspace, '.opencode/data');
    env.XDG_CONFIG_HOME = join(absWorkspace, '.opencode/config');
    env.XDG_CACHE_HOME = join(absWorkspace, '.opencode/cache');
    env.XDG_STATE_HOME = join(absWorkspace, '.opencode/state');

    return env;
  }

  private generateFenceSettings(): string {
    const networkMode = process.env.SANDBOX_NETWORK_MODE || 'MERGE';
    const userDomains = (process.env.WHITE_LIST_DOMAINS || '').split(',').filter(Boolean);
    const branchPatterns = (process.env.PRIMARY_BRANCH_PATTERNS || 'main,master').split(',');

    const defaultDomains = [
      'google.com',
      'wikipedia.org',
      'github.com',
      'api.github.com',
      'npmjs.com',
      'pypi.org',
    ];
    let finalDomains = defaultDomains;

    if (networkMode === 'REPLACE') {
      finalDomains = userDomains;
    } else if (networkMode === 'MERGE') {
      finalDomains = Array.from(new Set([...defaultDomains, ...userDomains]));
    } else if (networkMode === 'STRICT') {
      finalDomains = defaultDomains;
    }

    const settings = {
      network: {
        allowedDomains: finalDomains,
      },
      filesystem: {
        allowWrite: ['.'],
        // Fence rules are relative to sandbox root or absolute
        deny: ['../.env', '../sessions.json', '../src'],
      },
      command: {
        deny: [
          'rm -rf /',
          ...branchPatterns.map((p) => `git checkout ${p}`),
          ...branchPatterns.map((p) => `git push origin ${p}`),
          ...branchPatterns.map((p) => `git push origin HEAD:${p}`),
        ],
      },
    };

    const path = join(process.cwd(), '.fence.json');
    writeFileSync(path, JSON.stringify(settings, null, 2));
    return path;
  }

  async start(prompt?: string) {
    let args = ['run', '--format', 'json'];

    if (this.sessionId) {
      args.push('--session', this.sessionId);
    }

    if (prompt) {
      args.push(prompt);
    }

    let commandPath = '/opt/homebrew/bin/opencode';
    const useSandbox = process.env.USE_SANDBOX === 'true';
    const workspace = process.env.SANDBOX_WORKSPACE_DIR || './workspace';

    if (useSandbox) {
      const settingsPath = this.generateFenceSettings();
      // Using array-based spawn with '--' separator for Fence.
      // This bypasses shell interpretation entirely.
      const fenceArgs = ['--settings', settingsPath, '--', commandPath, 'run', '--format', 'json'];
      if (this.sessionId) {
        fenceArgs.push('--session', this.sessionId);
      }
      if (prompt) {
        fenceArgs.push(prompt);
      }
      commandPath = 'fence';
      args = fenceArgs;
    } else {
      if (this.sessionId) {
        args.push('--session', this.sessionId);
      }
      if (prompt) {
        args.push(prompt);
      }
    }

    console.log(`[Agent] Spawning: ${commandPath} ${args.join(' ')}`);

    try {
      this.process = spawn([commandPath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: null,
        cwd: useSandbox ? realpathSync(workspace) : process.cwd(),
        env: this.getAgentEnv(),
      });

      console.log(`[Agent] PID: ${this.process.pid}`);
      this.startHeartbeat();

      // Read streams concurrently
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
        if (value.length > 1024) {
          console.log(`[Agent] Received large data chunk: ${(value.length / 1024).toFixed(1)}KB`);
        }
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
        console.log(
          `[Agent Heartbeat] PID ${this.process?.pid} active, no log activity for ${inactiveSeconds}s...`,
        );
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
        // Skip malformed JSON or partials
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
      console.log('[Agent] Event: step_start');
      this.emit('thinking', true);
    } else if (event.type === 'step_finish') {
      const reason = event.part?.reason;
      console.log(`[Agent] Event: step_finish (${reason})`);
      this.emit('thinking', false);
      if (reason === 'stop') this.emit('idle');
    } else if (event.type === 'tool_use') {
      const toolName = event.part?.tool || event.tool;
      let inputStr = '';
      let outputLen = 0;
      if (event.part?.state?.input) {
        inputStr = JSON.stringify(event.part.state.input);
        if (inputStr.length > 200) {
          inputStr = inputStr.substring(0, 197) + '...';
        }
      }
      if (typeof event.part?.state?.output === 'string') {
        outputLen = event.part.state.output.length;
      }
      console.log(
        `[Agent] Tool Use: ${toolName} ${inputStr}${outputLen > 0 ? ` (Output: ${(outputLen / 1024).toFixed(1)}KB)` : ''}`,
      );
      if (outputLen > 102400) {
        console.log(
          '[Agent] Large tool output detected. LLM will likely take some time to process this context...',
        );
      }
    } else {
      console.log(`[Agent] Event: ${event.type}`);
    }
  }

  sendInput(_text: string) {
    console.warn('[Agent] Received input but session is not interactive.');
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
