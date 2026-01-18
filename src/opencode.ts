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
 * One-Shot OpenCode Process: Runs a single command and exits.
 * Reuses the same session ID if provided to preserve context.
 */
export class OneShotOpenCodeProcess extends EventEmitter implements Agent {
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
    this.stdoutPath = `logs/oneshot_${logId}_${turnId}.stdout`;
    this.stderrPath = `logs/oneshot_${logId}_${turnId}.stderr`;
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
    console.log(`[OneShot] Spawning: ${commandPath} ${args.join(' ')}`);

    writeFileSync(this.stdoutPath, '');
    writeFileSync(this.stderrPath, '');

    try {
      this.process = spawn([commandPath, ...args], {
        stdout: Bun.file(this.stdoutPath),
        stderr: Bun.file(this.stderrPath),
        stdin: null, // EOF immediately triggers the run
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
        },
      });

      console.log(`[OneShot] PID: ${this.process.pid}`);
      this.startHeartbeat();
      this.startTailing();

      const code = await this.process.exited;
      console.log(`[OneShot] PID ${this.process.pid} exited with code ${code}`);

      // Final tail to catch trailing data
      await new Promise((r) => setTimeout(r, 500));
      this.tailLog();
      this.stopTailing();
      this.stopHeartbeat();

      this.emit('exit', code);
    } catch (_error) {
      console.error('[OneShot] Failed to spawn:', _error);
      this.stopHeartbeat();
      this.emit('error', _error);
      throw _error;
    }
  }

  private startHeartbeat() {
    this.lastActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const inactiveSeconds = Math.floor((Date.now() - this.lastActivity) / 1000);
      if (inactiveSeconds >= 5) {
        console.log(
          `[OneShot Heartbeat] PID ${this.process?.pid} active, no activity for ${inactiveSeconds}s...`,
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
          this.handleChunk(readBuffer.toString('utf-8'));
        }
      }

      if (existsSync(this.stderrPath)) {
        const errStats = statSync(this.stderrPath);
        if (errStats.size > 0) {
          const errData = readFileSync(this.stderrPath, 'utf-8');
          if (errData.trim()) {
            this.emit('stderr', errData);
            writeFileSync(this.stderrPath, ''); // Clear to avoid re-emitting
          }
        }
      }
    } catch {
      // Log file might not exist yet
    }
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    let startIndex = this.buffer.indexOf('{');
    while (startIndex !== -1) {
      let braceCount = 0;
      let foundEnd = false;
      let i = startIndex;
      for (; i < this.buffer.length; i++) {
        if (this.buffer[i] === '{') braceCount++;
        else if (this.buffer[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            foundEnd = true;
            break;
          }
        }
      }
      if (foundEnd) {
        const jsonStr = this.buffer.substring(startIndex, i + 1);
        this.buffer = this.buffer.substring(i + 1);
        try {
          const event: OpenCodeEvent = JSON.parse(jsonStr);
          this.processEvent(event);
        } catch {
          // Ignore parse errors
        }
        startIndex = this.buffer.indexOf('{');
      } else {
        break;
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
    console.warn('[OneShot] Received input but session is not interactive.');
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

/**
 * Legacy/Persistent OpenCode Process (using stdin pipe)
 */
export class OpenCodeProcess extends EventEmitter implements Agent {
  private process: Subprocess | null = null;
  private buffer: string = '';
  private lastActivity: number = Date.now();
  private heartbeatTimer: Timer | null = null;
  private tailTimer: Timer | null = null;
  private stdoutPath: string;
  private stderrPath: string;
  private stdoutFd: number | null = null;
  private currentOffset: number = 0;

  constructor(private sessionId?: string) {
    super();
    const logId = this.sessionId || `temp_${Date.now()}`;
    this.stdoutPath = `logs/session_${logId}.stdout`;
    this.stderrPath = `logs/session_${logId}.stderr`;
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
    console.log(`[OpenCode] Spawning: ${commandPath} ${args.join(' ')}`);

    // Clear previous logs
    writeFileSync(this.stdoutPath, '');
    writeFileSync(this.stderrPath, '');

    try {
      const env = {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      };

      this.process = spawn([commandPath, ...args], {
        stdout: Bun.file(this.stdoutPath),
        stderr: Bun.file(this.stderrPath),
        stdin: 'pipe',
        env,
      });

      console.log(`[OpenCode] Process spawned with PID: ${this.process.pid}`);
      this.startHeartbeat();
      this.startTailing();

      this.process.exited.then((code) => {
        console.log(`[OpenCode] Process ${this.process?.pid} exited with code ${code}`);
        this.stopHeartbeat();
        setTimeout(() => this.stopTailing(), 2000);
        this.emit('exit', code);
        this.emit('thinking', false);
      });
    } catch (_error) {
      console.error('[OpenCode] Failed to spawn process:', _error);
      this.stopHeartbeat();
      this.emit('error', _error);
      throw _error;
    }
  }

  private startHeartbeat() {
    this.lastActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const inactiveSeconds = Math.floor((Date.now() - this.lastActivity) / 1000);
      if (inactiveSeconds >= 5) {
        console.log(
          `[OpenCode Heartbeat] PID ${this.process?.pid} is active, no log activity for ${inactiveSeconds}s...`,
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
          this.handleChunk(data);
        }
      }

      if (existsSync(this.stderrPath)) {
        const errStats = statSync(this.stderrPath);
        if (errStats.size > 0) {
          const errData = readFileSync(this.stderrPath, 'utf-8');
          if (errData.trim()) {
            this.emit('stderr', errData);
            writeFileSync(this.stderrPath, '');
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    let startIndex = this.buffer.indexOf('{');
    while (startIndex !== -1) {
      let braceCount = 0;
      let foundEnd = false;
      let i = startIndex;

      for (; i < this.buffer.length; i++) {
        if (this.buffer[i] === '{') braceCount++;
        else if (this.buffer[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            foundEnd = true;
            break;
          }
        }
      }

      if (foundEnd) {
        const jsonStr = this.buffer.substring(startIndex, i + 1);
        this.buffer = this.buffer.substring(i + 1);
        try {
          const event: OpenCodeEvent = JSON.parse(jsonStr);
          console.log(
            `[OpenCode Event] type=${event.type} sessionID=${event.sessionID || event.part?.sessionID || 'unknown'}`,
          );
          this.emit('event', event);
          this.processEvent(event);
        } catch {
          // Skip partials
        }
        startIndex = this.buffer.indexOf('{');
      } else {
        break;
      }
    }
  }

  private processEvent(event: OpenCodeEvent) {
    switch (event.type) {
      case 'step_start':
        this.emit('thinking', true);
        break;
      case 'step_finish':
        this.emit('thinking', false);
        if (event.part?.reason === 'stop') {
          this.emit('idle');
        }
        break;
      case 'text': {
        const text = event.part?.text || event.text;
        if (text) {
          this.emit('output', text);
        }
        break;
      }
      case 'tool_use':
        this.emit('output', '🛠️ **Using tool...**');
        break;
    }
  }

  sendInput(text: string) {
    if (this.process?.stdin && typeof this.process.stdin !== 'number') {
      console.log(`[OpenCode] Injecting input to PID ${this.process.pid}: ${text}`);
      this.process.stdin.write(text + '\n');
      this.process.stdin.flush();
      this.lastActivity = Date.now();
    }
  }

  interrupt() {
    if (this.process?.stdin && typeof this.process.stdin !== 'number') {
      console.log(`[OpenCode] Sending interrupt (ESC ESC) to PID ${this.process.pid}`);
      this.process.stdin.write('\x1b\x1b');
      this.process.stdin.flush();
      this.lastActivity = Date.now();
    }
  }

  async stop(): Promise<number | void> {
    if (this.process) {
      console.log(`[OpenCode] Killing process for PID ${this.process.pid}`);
      const exited = this.process.exited;
      this.process.kill();
      this.process = null;
      this.stopHeartbeat();
      this.stopTailing();
      return exited;
    }
    this.stopHeartbeat();
    this.stopTailing();
    return Promise.resolve();
  }

  getPid(): number | undefined {
    return this.process?.pid;
  }

  getStdoutPath() {
    return this.stdoutPath;
  }

  getStderrPath() {
    return this.stderrPath;
  }
}
