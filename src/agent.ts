import type { EventEmitter } from "node:events";

export interface Agent extends EventEmitter {
	start(prompt?: string): Promise<void>;
	sendInput(text: string): void;
	stop(): Promise<number | undefined>;
	getPid(): number | undefined;
	getStdoutPath(): string;
	getStderrPath(): string;
}
