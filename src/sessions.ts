import { spawn } from 'bun';
import { OpenCodeAgent, type OpenCodeEvent } from './opencode';
import { MockProcess } from './mock';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  copyFileSync,
  statSync,
  readdirSync,
} from 'fs';
import { type Agent } from './agent';
import { SandboxManager } from './sandbox/manager';
import { join } from 'path';
import { type Config } from './discord';

const ANIMALS = [
  'panda',
  'zebra',
  'koala',
  'otter',
  'tiger',
  'lion',
  'fox',
  'wolf',
  'bear',
  'deer',
  'eagle',
  'hawk',
  'owl',
  'swan',
  'duck',
  'crane',
  'frog',
  'toad',
  'newt',
  'crab',
  'whale',
  'shark',
  'seal',
  'walrus',
  'squid',
  'orca',
  'tuna',
  'pike',
  'bass',
  'carp',
  'cat',
  'dog',
  'horse',
  'sheep',
  'goat',
  'cow',
  'pig',
  'rabbit',
  'mouse',
  'rat',
  'bat',
  'bee',
  'ant',
  'wasp',
  'moth',
  'worm',
  'slug',
  'snail',
  'fly',
  'gnat',
  'hippo',
  'rhino',
  'parrot',
  'gecko',
  'falcon',
  'badger',
  'marmot',
  'lynx',
  'puma',
  'jaguar',
  'sloth',
  'lemur',
  'mole',
  'shrew',
  'vole',
  'elk',
  'moose',
  'bison',
  'camel',
  'llama',
  'albatross',
  'puffin',
  'pelican',
  'heron',
  'stork',
  'raven',
  'finch',
  'robin',
  'lark',
  'swift',
  'marlin',
  'salmon',
  'trout',
  'eel',
  'ray',
  'shrimp',
  'prawn',
  'lobster',
  'clam',
  'oyster',
  'beetle',
  'spider',
  'tick',
  'mite',
  'cicada',
  'cricket',
  'mantis',
  'wasp',
  'hornet',
  'wasp',
  'iguana',
  'turtle',
  'cobra',
  'viper',
  'python',
  'adder',
  'skink',
  'cobra',
  'anole',
  'sidewinder',
];

export interface SessionData {
  channels: Record<string, string>;
  categoryId: string | null;
  types: Record<string, 'standard' | 'mock'>;
  sessionCounts: Record<string, number>;
  aliases: Record<string, string>;
  bindings: Record<string, string>;
}

export class SessionManager {
  private sessions: Map<string, Agent> = new Map();
  private channelToSession: Map<string, string> = new Map();
  private channelToType: Map<string, 'standard' | 'mock'> = new Map();
  private channelToCount: Map<string, number> = new Map();
  private aliasToSession: Map<string, string> = new Map();
  private channelToBinding: Map<string, string> = new Map();
  private categoryId: string | null = null;
  private readonly PERSISTENCE_FILE: string;
  private sandboxManager: SandboxManager | null = null;
  private readonly workspacePath: string;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.PERSISTENCE_FILE = config.discord.sessionDb || 'sessions.json';
    this.workspacePath = config.sandbox.workspaceDir;

    if (!existsSync(this.workspacePath)) {
      mkdirSync(this.workspacePath, { recursive: true });
      chmodSync(this.workspacePath, 0o777);
    }

    if (config.sandbox.enabled) {
      console.log('[Manager] Sandbox enabled. Initializing SandboxManager...');
      this.sandboxManager = new SandboxManager(
        this.workspacePath,
        config.sandbox.ghToken,
        config.apiKeys,
      );
      this.sandboxManager.start();

      const sandboxBin = join(this.workspacePath, '.bin');
      this.sandboxManager.setupShims(sandboxBin);
      this.chmodRecursive(sandboxBin, 0o777);
    }

    this.loadPersistence();
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

  private savePersistence() {
    const data: SessionData = {
      channels: Object.fromEntries(this.channelToSession.entries()),
      categoryId: this.categoryId,
      types: Object.fromEntries(this.channelToType.entries()),
      sessionCounts: Object.fromEntries(this.channelToCount.entries()),
      aliases: Object.fromEntries(this.aliasToSession.entries()),
      bindings: Object.fromEntries(this.channelToBinding.entries()),
    };
    writeFileSync(this.PERSISTENCE_FILE, JSON.stringify(data, null, 2));
  }

  private loadPersistence() {
    if (existsSync(this.PERSISTENCE_FILE)) {
      try {
        const data = JSON.parse(readFileSync(this.PERSISTENCE_FILE, 'utf-8'));
        if (data.channels) this.channelToSession = new Map(Object.entries(data.channels));
        if (data.types) this.channelToType = new Map(Object.entries(data.types));
        if (data.sessionCounts) {
          this.channelToCount = new Map(
            Object.entries(data.sessionCounts).map(([k, v]) => [k, Number(v)]),
          );
        }
        if (data.aliases) this.aliasToSession = new Map(Object.entries(data.aliases));
        if (data.bindings) this.channelToBinding = new Map(Object.entries(data.bindings));
        this.categoryId = data.categoryId || null;
      } catch {
        console.error('Failed to load persistence:');
      }
    }
  }

  setCategoryId(id: string | null) {
    this.categoryId = id;
    this.savePersistence();
  }

  getCategoryId(): string | null {
    return this.categoryId;
  }

  bindChannelToFolder(channelId: string, folderName: string) {
    const sanitized = folderName.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!sanitized) throw new Error('Invalid folder name');
    this.channelToBinding.set(channelId, sanitized);
    this.savePersistence();
    return sanitized;
  }

  getBinding(channelId: string) {
    return this.channelToBinding.get(channelId);
  }

  generateBotSessionId(): string {
    const unusedAnimals = ANIMALS.filter((a) => !this.aliasToSession.has(a));
    const list = unusedAnimals.length > 0 ? unusedAnimals : ANIMALS;
    return list[Math.floor(Math.random() * list.length)] || 'agent';
  }

  resolveSessionId(input: string): string {
    if (this.aliasToSession.has(input)) return this.aliasToSession.get(input)!;
    if (input.startsWith('ses_')) return input;
    return `ses_${input}`;
  }

  setAlias(alias: string, sessionId: string) {
    this.aliasToSession.set(alias, sessionId);
    this.savePersistence();
  }

  getAliasForSession(sessionId: string): string | undefined {
    for (const [alias, sid] of this.aliasToSession.entries()) {
      if (sid === sessionId) return alias;
    }
    return undefined;
  }

  private attachIdListener(channelId: string, session: Agent) {
    session.on('event', (event: OpenCodeEvent) => {
      const sid = event.sessionID || event.part?.sessionID;
      if (sid) {
        const currentSid = this.channelToSession.get(channelId);
        if (currentSid !== sid) {
          this.channelToSession.set(channelId, sid);
          if (!this.getAliasForSession(sid)) {
            const alias = this.generateBotSessionId();
            this.setAlias(alias, sid);
          }
          this.savePersistence();
        }
      }
    });
  }

  prepareSession(channelId: string, sessionId?: string): Agent {
    const sid = sessionId ? this.resolveSessionId(sessionId) : undefined;
    const binding = this.getBinding(channelId);
    const folderName = binding || sid || `temp_${Date.now()}`;
    const sessionWorkspace = join(this.workspacePath, folderName);

    if (!existsSync(sessionWorkspace)) {
      mkdirSync(sessionWorkspace, { recursive: true });
    }

    // Create necessary dirs
    const dotLocal = join(sessionWorkspace, '.local');
    const dotConfig = join(sessionWorkspace, '.config');
    if (!existsSync(dotLocal)) mkdirSync(dotLocal, { recursive: true });
    if (!existsSync(dotConfig)) mkdirSync(dotConfig, { recursive: true });

    // Generate port for Sandbox Local Bridge
    const sandboxLocalPort = Math.floor(Math.random() * 1000) + 8000;

    // Sync Config & PATCH it for local bridge
    const hostConfigPath = this.config.sandbox.opencodeConfigPath;
    if (hostConfigPath && existsSync(hostConfigPath)) {
      const sandboxConfigDir = join(sessionWorkspace, '.config', 'opencode');
      if (!existsSync(sandboxConfigDir)) mkdirSync(sandboxConfigDir, { recursive: true });
      try {
        const configText = readFileSync(hostConfigPath, 'utf-8');
        const config = JSON.parse(configText);
        if (!config.provider) config.provider = {};
        const providers = ['google', 'openai', 'anthropic'];
        for (const p of providers) {
          if (!config.provider[p]) config.provider[p] = {};
          if (!config.provider[p].options) config.provider[p].options = {};
          const path = p === 'google' ? '/google' : `/${p}`;
          config.provider[p].options.baseURL = `http://127.0.0.1:${sandboxLocalPort}${path}`;
        }
        writeFileSync(join(sandboxConfigDir, 'opencode.json'), JSON.stringify(config, null, 2));
      } catch {
        copyFileSync(hostConfigPath, join(sandboxConfigDir, 'opencode.json'));
      }
    }

    // Ghost Auth
    const sandboxDataDir = join(sessionWorkspace, '.local', 'share', 'opencode');
    if (!existsSync(sandboxDataDir)) mkdirSync(sandboxDataDir, { recursive: true });
    const ghostAuth = {
      google: { type: 'api', key: 'SANDBOX_MANAGED_GHOST_KEY_1234567890' },
      openai: { type: 'api', key: 'sk-sandbox-managed-ghost-key-1234567890' },
      anthropic: { type: 'api', key: 'sk-ant-sid-sandbox-managed-ghost-key' },
    };
    writeFileSync(join(sandboxDataDir, 'auth.json'), JSON.stringify(ghostAuth, null, 2));

    this.chmodRecursive(sessionWorkspace, 0o777);

    const bridgeSock = this.sandboxManager?.getSocketPath() || '';
    const proxySock = this.sandboxManager?.getProxySocketPath() || '';

    // Create entrypoint.sh in workspace
    const entrypointPath = join(sessionWorkspace, 'entrypoint.sh');
    const entrypoint = `#!/bin/bash
export HOME="${sessionWorkspace}"
export XDG_CONFIG_HOME="${sessionWorkspace}/.config"
export BRIDGE_SOCK="${bridgeSock}"
export PROXY_SOCK="${proxySock}"
export PATH="${this.workspacePath}/.bin:$PATH"

# Start HTTP-to-Unix Bridge (inside sandbox) to punch through to host proxy
python3 "${this.workspacePath}/.bin/http_to_unix.py" ${sandboxLocalPort} > /dev/null 2>&1 &
BRIDGE_PID=$!

sleep 0.5
export GOOGLE_GENERATIVE_AI_BASE_URL="http://127.0.0.1:${sandboxLocalPort}/google"
export OPENAI_BASE_URL="http://127.0.0.1:${sandboxLocalPort}/openai/v1"
export ANTHROPIC_BASE_URL="http://127.0.0.1:${sandboxLocalPort}/anthropic"

exec "$@"
RET=$?
kill $BRIDGE_PID 2>/dev/null
exit $RET
`;
    writeFileSync(entrypointPath, entrypoint);
    chmodSync(entrypointPath, 0o755);

    const session = new OpenCodeAgent(sid, {
      workspacePath: sessionWorkspace,
      useSandbox: this.config.sandbox.enabled,
      sandboxBinDir: join(this.workspacePath, '.bin'),
      entrypoint: entrypointPath,
    });

    this.sessions.set(channelId, session);
    if (sid) this.channelToSession.set(channelId, sid);
    this.channelToType.set(channelId, 'standard');
    this.savePersistence();
    this.attachIdListener(channelId, session);
    return session;
  }

  prepareMockSession(channelId: string, sessionId?: string): Agent {
    const sid = sessionId ? this.resolveSessionId(sessionId) : `ses_${this.generateBotSessionId()}`;
    const session = new MockProcess(sid);
    this.sessions.set(channelId, session);
    this.channelToSession.set(channelId, sid);
    this.channelToType.set(channelId, 'mock');
    this.savePersistence();
    return session;
  }

  getChannelMapping() {
    return this.channelToSession;
  }
  getSession(channelId: string): Agent | undefined {
    return this.sessions.get(channelId);
  }
  getSessionType(channelId: string) {
    return this.channelToType.get(channelId);
  }
  getCurrentSessionCount(channelId: string): number {
    return this.channelToCount.get(channelId) || 1;
  }
  getNextSessionCount(channelId: string): number {
    const next = (this.channelToCount.get(channelId) || 0) + 1;
    this.channelToCount.set(channelId, next);
    this.savePersistence();
    return next;
  }

  removeSession(channelId: string, keepMapping = false) {
    const session = this.sessions.get(channelId);
    if (session) {
      session.stop();
      this.sessions.delete(channelId);
    }
    if (!keepMapping && this.channelToSession.has(channelId)) {
      this.channelToSession.delete(channelId);
      this.channelToType.delete(channelId);
      this.savePersistence();
    }
  }

  async stopAll() {
    const stopPromises = [];
    for (const session of this.sessions.values()) {
      stopPromises.push(session.stop());
    }
    await Promise.all(stopPromises);
    this.sessions.clear();
  }
}
