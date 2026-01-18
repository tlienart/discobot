import { EventEmitter } from 'events';

export class MockProcess extends EventEmitter {
  constructor(private sessionId: string) {
    super();
  }

  async start(prompt?: string) {
    console.log(`[Mock] Starting session ${this.sessionId} with prompt: ${prompt}`);
    if (prompt) {
      await this.processMessage(prompt);
    }
  }

  sendInput(text: string) {
    console.log(`[Mock] Received input: ${text}`);
    this.processMessage(text);
  }

  private async processMessage(text: string) {
    // Simulate thinking
    this.emit('thinking', true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.emit('thinking', false);

    // Emit uppercased result
    this.emit('output', text.toUpperCase());
    this.emit('idle');
  }

  async stop() {
    console.log(`[Mock] Stopping session ${this.sessionId}`);
  }

  getPid() {
    return 99999;
  }

  getStdoutPath() {
    return '';
  }

  getStderrPath() {
    return '';
  }
}
