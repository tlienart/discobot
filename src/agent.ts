import { EventEmitter } from 'events';

export interface Agent extends EventEmitter {
  start(prompt?: string): Promise<void>;
  sendInput(text: string): void;
  stop(): Promise<number | void>;
  getPid(): number | undefined;
  getStdoutPath(): string;
  getStderrPath(): string;
}
