import { EventEmitter } from 'events';
import { spawn, type Subprocess } from 'bun';
import {
  openSync,
  readSync,
  statSync,
  closeSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
import { type Agent } from './agent';

export interface OpenCodeEvent {
  type: string;
  text?: string;
  sessionID?: string;
  part?: {
    type: string;
    text?: string;
    reason?: string;
    sessionID?: string;
  };
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
  private stdoutFd: number | null = null;
  private currentOffset: number = 0;
  private tailTimer: Timer | null = null;
  private lastActivity: number = Date.now();
  private heartbeatTimer: Timer | null = null;

  constructor(private sessionId?: string) {
    super();
    // Unique log file per turn to avoid lock issues
    const logId = this.sessionId || `temp_${Date.now()}`;
    const turnId = Date.now();
    this.stdoutPath = `logs/agent_${logId}_${turnId}.stdout`;
    this.stderrPath = `logs/agent_${logId}_${turnId}.stderr`;
  }

  async start(prompt?: string) {
    const args = ['run', '--format', 'json'];

    if (this.sessionId) {
      args.push('--session', this.sessionId);
    }

    if (prompt) {
      args.push(prompt);
    }

    const commandPath = '/opt/homebrew/bin/opencode';
    console.log(`[Agent] Spawning: ${commandPath} ${args.join(' ')}`);

    writeFileSync(this.stdoutPath, '');
    writeFileSync(this.stderrPath, '');

    try {
      this.process = spawn([commandPath, ...args], {
        stdout: Bun.file(this.stdoutPath),
        stderr: Bun.file(this.stderrPath),
        stdin: null, // EOF immediately triggers the run
        env: {
          ...process.env,
          // Removed TERM and FORCE_COLOR to ensure non-interactive JSON output
        },
      });

      console.log(`[Agent] PID: ${this.process.pid}`);
      this.startHeartbeat();
      this.startTailing();

      const code = await this.process.exited;
      console.log(`[Agent] PID ${this.process.pid} exited with code ${code}`);

      // Final tail to catch trailing data
      await new Promise((r) => setTimeout(r, 500));
      this.tailLog();
      this.stopTailing();
      this.stopHeartbeat();

      this.emit('exit', code);
    } catch (error) {
      console.error('[Agent] Failed to spawn:', error);
      this.stopHeartbeat();
      this.emit('error', error);
      throw error;
    }
  }

  private startHeartbeat() {
    this.lastActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const inactiveSeconds = Math.floor((Date.now() - this.lastActivity) / 1000);
      if (inactiveSeconds >= 5) {
        console.log(
          `[Agent Heartbeat] PID ${this.process?.pid} active, no activity for ${inactiveSeconds}s...`,
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

  private startTailing() {
    this.currentOffset = 0;
    this.tailTimer = setInterval(() => {
      this.tailLog();
    }, 200);
  }

  private stopTailing() {
    if (this.tailTimer) {
      clearInterval(this.tailTimer);
      this.tailTimer = null;
    }
    if (this.stdoutFd !== null) {
      closeSync(this.stdoutFd);
      this.stdoutFd = null;
    }
  }

  private tailLog() {
    try {
      if (existsSync(this.stdoutPath)) {
        const stats = statSync(this.stdoutPath);
        if (stats.size > this.currentOffset) {
          if (this.stdoutFd === null) {
            this.stdoutFd = openSync(this.stdoutPath, 'r');
          }
          const bufferSize = stats.size - this.currentOffset;
          const readBuffer = Buffer.alloc(bufferSize);
          readSync(this.stdoutFd, readBuffer, 0, bufferSize, this.currentOffset);
          this.currentOffset = stats.size;
          this.lastActivity = Date.now();
          const data = readBuffer.toString('utf-8');
          // console.debug(`[Agent] Read ${bufferSize} bytes from stdout`);
          this.handleChunk(data);
        }
      }

      if (existsSync(this.stderrPath)) {
        const errStats = statSync(this.stderrPath);
        if (errStats.size > 0) {
          const errData = readFileSync(this.stderrPath, 'utf-8');
          if (errData.trim()) {
            console.warn(`[Agent Stderr] ${errData}`);
            this.emit('stderr', errData);
            writeFileSync(this.stderrPath, ''); // Clear to avoid re-emitting
          }
        }
      }
    } catch (e) {
      console.error('[Agent Tail Error]', e);
    }
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep last partial line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event: OpenCodeEvent = JSON.parse(line);
        this.processEvent(event);
      } catch {
        // Skip lines that aren't JSON (like ANSI residue)
      }
    }
  }

  private processEvent(event: OpenCodeEvent) {
    this.emit('event', event);
    if (event.type === 'text') {
      const text = event.part?.text || event.text;
      if (text) this.emit('output', text);
    } else if (event.type === 'step_start') {
      this.emit('thinking', true);
    } else if (event.type === 'step_finish') {
      this.emit('thinking', false);
      if (event.part?.reason === 'stop') this.emit('idle');
    }
  }

  sendInput(_text: string) {
    console.warn('[Agent] Received input but session is not interactive.');
  }

  async stop() {
    this.process?.kill();
    this.stopTailing();
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
