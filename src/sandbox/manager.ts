import {
  writeFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
  readFileSync,
  statSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { HostBridge } from './bridge';

export class SandboxManager {
  private bridge: HostBridge;
  private workspacePath: string;

  constructor(workspacePath: string, sandboxToken?: string, apiKeys?: Record<string, string>) {
    this.workspacePath = workspacePath;
    this.bridge = new HostBridge(workspacePath, sandboxToken, apiKeys);
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

  getProxySocketPath() {
    return this.bridge.getProxySocketPath();
  }

  private chmodRecursive(path: string, mode: number) {
    if (!existsSync(path)) return;
    try {
      chmodSync(path, mode);
      if (statSync(path).isDirectory()) {
        for (const item of readdirSync(path)) {
          this.chmodRecursive(join(path, item), mode);
        }
      }
    } catch {
      // Ignore
    }
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

    // Copy http_to_unix.py to target bin dir
    const bridgeSourcePath = join(__dirname, 'http_to_unix.py');
    const bridgeDestPath = join(targetBinDir, 'http_to_unix.py');
    if (existsSync(bridgeSourcePath)) {
      const bridgeContent = readFileSync(bridgeSourcePath);
      writeFileSync(bridgeDestPath, bridgeContent);
      chmodSync(bridgeDestPath, 0o755);
    }

    for (const tool of tools) {
      const shimPath = join(targetBinDir, tool);
      const content = `#!/bin/bash
BRIDGE_SOCK="${this.getSocketPath()}" SHIM_COMMAND="${tool}" /usr/bin/python3 "${shimDestPath}" "$@"
`;
      writeFileSync(shimPath, content);
      chmodSync(shimPath, 0o755);
    }

    this.chmodRecursive(targetBinDir, 0o777);
  }
}
