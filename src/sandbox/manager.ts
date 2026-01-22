import { writeFileSync, chmodSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { HostBridge } from './bridge';

export class SandboxManager {
  private bridge: HostBridge;
  private workspacePath: string;

  constructor(workspacePath: string, sandboxToken?: string) {
    this.workspacePath = workspacePath;
    this.bridge = new HostBridge(workspacePath, sandboxToken);
  }

  async start() {
    await this.bridge.start();
  }

  stop() {
    this.bridge.stop();
  }

  getSocketPath() {
    return this.bridge.getSocketPath();
  }

  /**
   * Creates shim scripts in the specified directory.
   */
  setupShims(targetBinDir: string) {
    if (!existsSync(targetBinDir)) {
      mkdirSync(targetBinDir, { recursive: true });
    }

    const tools = ['gh', 'git'];
    const shimSourcePath = join(__dirname, 'shim.py');
    const shimDestPath = join(targetBinDir, 'shim.py');

    // Copy shim.py to target bin dir
    if (existsSync(shimSourcePath)) {
      const shimContent = readFileSync(shimSourcePath);
      writeFileSync(shimDestPath, shimContent);
      chmodSync(shimDestPath, 0o755);
    }

    for (const tool of tools) {
      const shimPath = join(targetBinDir, tool);
      const content = `#!/bin/bash
BRIDGE_SOCK="${this.getSocketPath()}" SHIM_COMMAND="${tool}" /usr/bin/python3 "${shimDestPath}" "$@"
`;
      writeFileSync(shimPath, content);
      chmodSync(shimPath, 0o755);
      console.log(`[Sandbox] Created shim for ${tool} at ${shimPath}`);
    }
  }
}
