import { EventEmitter } from 'events';
import { spawn, type Subprocess } from 'bun';
import { writeFileSync, existsSync, mkdirSync, realpathSync, readdirSync, statSync } from 'fs';
import { type Agent } from './agent';
import { join } from 'path';

export interface OpenCodeEvent {
  type: string;
  text?: string;
  sessionID?: string;
  tool?: string;
  error?: {
    name?: string;
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

    // Pre-create standard OpenCode data paths to avoid EPERM on mkdir inside sandbox
    const paths = [
      env.XDG_DATA_HOME,
      env.XDG_CONFIG_HOME,
      env.XDG_CACHE_HOME,
      env.XDG_STATE_HOME,
      join(env.XDG_DATA_HOME, 'opencode/log'),
      join(env.XDG_DATA_HOME, 'opencode/session'),
    ];
    for (const p of paths) {
      if (!existsSync(p)) mkdirSync(p, { recursive: true });
    }

    return env;
  }

  private generateFenceSettings(): string {
    const networkMode = process.env.SANDBOX_NETWORK_MODE || 'MERGE';
    const userDomains = (process.env.WHITE_LIST_DOMAINS || '').split(',').filter(Boolean);
    const branchPatterns = (process.env.PRIMARY_BRANCH_PATTERNS || 'main,master').split(',');

    const defaultDomains = [
      'opencode.ai',
      '*.opencode.ai',
      'google.com',
      '*.googleapis.com',
      '*.gstatic.com',
      'wikipedia.org',
      'github.com',
      'api.github.com',
      'codeload.github.com',
      'raw.githubusercontent.com',
      'objects.githubusercontent.com',
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

    const projectRoot = realpathSync(process.cwd());
    const homeDir = process.env.HOME || '';
    const workspace = process.env.SANDBOX_WORKSPACE_DIR || './workspace';
    const absWorkspace = realpathSync(workspace);

    const settings = {
      network: {
        allowedDomains: finalDomains,
      },
      filesystem: {
        allowWrite: ['.', absWorkspace, '/private/tmp', '/tmp'],
        allowRead: ['/'],
        // Explicitly deny sensitive host paths
        denyRead: [
          join(projectRoot, '.env'),
          join(projectRoot, 'sessions.json'),
          join(projectRoot, 'src'),
          join(homeDir, '.ssh'),
          join(homeDir, '.aws'),
          join(homeDir, '.gitconfig'),
          join(homeDir, '.gnupg'),
        ],
        denyWrite: [
          join(projectRoot, '.env'),
          join(projectRoot, 'sessions.json'),
          join(projectRoot, 'src'),
        ],
      },
      command: {
        deny: [
          'rm -rf /',
          ...branchPatterns.map((p) => `git checkout ${p}`),
          ...branchPatterns.map((p) => `git push origin ${p}`),
          ...branchPatterns.map((p) => `git push origin HEAD:${p}`),
          // Add sensitive file names to command deny list to trigger loud Fence blocks
          '.env',
          'sessions.json',
          'src/',
          '.ssh',
          '.aws',
        ],
      },
    };

    const path = join(process.cwd(), '.fence.json');
    writeFileSync(path, JSON.stringify(settings, null, 2));
    return path;
  }

  async start(prompt?: string) {
    let finalArgs: string[] = [];
    let commandPath = '/opt/homebrew/bin/opencode';
    const useSandbox = process.env.USE_SANDBOX === 'true';
    const workspace = process.env.SANDBOX_WORKSPACE_DIR || './workspace';

    // Verify if session exists before trying to use it
    let activeSessionId = this.sessionId;
    if (activeSessionId && activeSessionId.startsWith('ses_')) {
      const homeDir = process.env.HOME || '';
      // OpenCode session path pattern
      const sessionPath = join(homeDir, '.local/share/opencode/storage/session');
      // Within sandbox, it's different
      const sandboxSessionPath = join(
        realpathSync(workspace),
        '.opencode/data/opencode/storage/session',
      );

      const findSession = (basePath: string, sid: string): boolean => {
        if (!existsSync(basePath)) return false;
        const dirs = readdirSync(basePath);
        for (const dir of dirs) {
          const fullDir = join(basePath, dir);
          if (statSync(fullDir).isDirectory()) {
            const files = readdirSync(fullDir);
            if (files.some((f) => f.startsWith(sid))) return true;
          }
        }
        return false;
      };

      let found = false;
      if (useSandbox) {
        found = findSession(sandboxSessionPath, activeSessionId);
      } else {
        found = findSession(sessionPath, activeSessionId);
      }

      if (!found) {
        console.log(`[Agent] Session ${activeSessionId} not found in storage. Starting fresh.`);
        activeSessionId = undefined;
      }
    }

    if (useSandbox) {
      const settingsPath = this.generateFenceSettings();
      // Using array-based spawn with '--' separator for Fence and '--' for opencode run message.
      // This ensures the prompt is NEVER interpreted as a flag.
      finalArgs = ['--settings', settingsPath, '--', commandPath, 'run', '--format', 'json'];
      if (activeSessionId) {
        finalArgs.push('--session', activeSessionId);
      }
      if (prompt) {
        finalArgs.push('--', prompt);
      }
      commandPath = 'fence';
    } else {
      finalArgs = ['run', '--format', 'json'];
      if (activeSessionId) {
        finalArgs.push('--session', activeSessionId);
      }
      if (prompt) {
        finalArgs.push('--', prompt);
      }
    }

    console.log(`[Agent] Spawning: ${commandPath} ${finalArgs.join(' ')}`);

    try {
      const startTime = Date.now();
      console.log(`[Agent] Spawning PID...`);

      this.process = spawn([commandPath, ...finalArgs], {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: null,
        cwd: useSandbox ? realpathSync(workspace) : process.cwd(),
        env: this.getAgentEnv(),
      });

      console.log(`[Agent] PID: ${this.process.pid} (Spawned in ${Date.now() - startTime}ms)`);
      this.startHeartbeat();

      let firstByteReceived = false;

      // Read streams concurrently
      const stdoutReader =
        this.process.stdout instanceof ReadableStream
          ? this.readStream(this.process.stdout, (data) => {
              if (!firstByteReceived) {
                firstByteReceived = true;
                console.log(
                  `[Agent] First byte received from pipe after ${Date.now() - startTime}ms (Engine Boot complete).`,
                );
              }
              this.handleChunk(data);
              writeFileSync(this.stdoutPath, data, { flag: 'a' });
            })
          : Promise.resolve();

      const stderrReader =
        this.process.stderr instanceof ReadableStream
          ? this.readStream(this.process.stderr, (data) => {
              // Real-time violation detection (Fence blocks or OS-level sandbox blocks)
              const lowerData = data.toLowerCase();
              const isViolation =
                data.includes('fence:') ||
                lowerData.includes('operation not permitted') ||
                lowerData.includes('permission denied') ||
                lowerData.includes('command blocked');

              // Filter out non-fatal system warnings like getcwd/shell-init
              const isIgnoredWarning =
                lowerData.includes('shell-init') ||
                lowerData.includes('getcwd') ||
                lowerData.includes('not a tty');

              if (isViolation && !isIgnoredWarning) {
                let message = data.trim();
                // Clean up the message if it has the fence prefix
                const violationMatch = data.match(/fence: (.*)/);
                if (violationMatch && violationMatch[1]) {
                  message = violationMatch[1];
                }
                this.emit('sandbox_violation', message);

                // Immediate kill to prevent hanging and resource usage
                console.warn(
                  `[Agent] Security violation detected, killing PID ${this.process?.pid}: ${message}`,
                );
                this.process?.kill();
                // Ensure the process exit is captured
                this.emit('exit', 1);
              }

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
