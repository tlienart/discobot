import { OpenCodeAgent, type OpenCodeEvent } from './opencode';
import { MockProcess } from './mock';
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, copyFileSync } from 'fs';
import { type Agent } from './agent';
import { SandboxManager } from './sandbox/manager';
import { join } from 'path';

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

  constructor(persistenceFile: string = 'sessions.json') {
    this.PERSISTENCE_FILE = persistenceFile;

    const configWorkspace = process.env.SANDBOX_WORKSPACE_DIR || './workspace';
    if (configWorkspace.startsWith('./') || !configWorkspace.startsWith('/')) {
      if (process.env.USE_SANDBOX === 'true') {
        this.workspacePath = join('/Users/Shared', 'discobot-workspace');
      } else {
        this.workspacePath = join(process.cwd(), configWorkspace);
      }
    } else {
      this.workspacePath = configWorkspace;
    }

    if (!existsSync(this.workspacePath)) {
      mkdirSync(this.workspacePath, { recursive: true });
      chmodSync(this.workspacePath, 0o777);
    }

    if (process.env.USE_SANDBOX === 'true') {
      console.log('[Manager] Sandbox enabled. Initializing SandboxManager...');
      this.sandboxManager = new SandboxManager(this.workspacePath, process.env.SANDBOX_GH_TOKEN);
      this.sandboxManager.start();

      const sandboxBin = join(this.workspacePath, '.bin');
      this.sandboxManager.setupShims(sandboxBin);
      chmodSync(sandboxBin, 0o777);
    }

    this.loadPersistence();
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
      } catch (error) {
        console.error('Failed to load persistence:', error);
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
      chmodSync(sessionWorkspace, 0o777);
    }

    // Ensure .local and .config are writable
    const dotLocal = join(sessionWorkspace, '.local');
    const dotConfig = join(sessionWorkspace, '.config');
    if (!existsSync(dotLocal)) {
      mkdirSync(dotLocal);
      chmodSync(dotLocal, 0o777);
    }
    if (!existsSync(dotConfig)) {
      mkdirSync(dotConfig);
      chmodSync(dotConfig, 0o777);
    }

    // Sync Config if specified
    const hostConfigPath = process.env.OPENCODE_CONFIG_PATH;
    if (hostConfigPath && existsSync(hostConfigPath)) {
      const sandboxConfigDir = join(sessionWorkspace, '.config', 'opencode');
      if (!existsSync(sandboxConfigDir)) mkdirSync(sandboxConfigDir, { recursive: true });
      copyFileSync(hostConfigPath, join(sandboxConfigDir, 'opencode.json'));
      chmodSync(sandboxConfigDir, 0o777);
      chmodSync(join(sandboxConfigDir, 'opencode.json'), 0o666);
    }

    // Sync Auth if found (usually in ~/.local/share/opencode/auth.json)
    const hostAuthPath =
      process.env.OPENCODE_AUTH_PATH ||
      join(process.env.HOME || '', '.local/share/opencode/auth.json');
    if (existsSync(hostAuthPath)) {
      const sandboxDataDir = join(sessionWorkspace, '.local', 'share', 'opencode');
      if (!existsSync(sandboxDataDir)) mkdirSync(sandboxDataDir, { recursive: true });
      copyFileSync(hostAuthPath, join(sandboxDataDir, 'auth.json'));
      chmodSync(sandboxDataDir, 0o777);
      chmodSync(join(sandboxDataDir, 'auth.json'), 0o666);
    }

    const proxyPort = this.sandboxManager?.getProxyPort() || 0;

    const session = new OpenCodeAgent(sid, {
      workspacePath: sessionWorkspace,
      useSandbox: process.env.USE_SANDBOX === 'true',
      sandboxBinDir: join(this.workspacePath, '.bin'),
      env: {
        HOME: sessionWorkspace,
        XDG_CONFIG_HOME: join(sessionWorkspace, '.config'),
        GOOGLE_GENERATIVE_AI_BASE_URL: `http://localhost:${proxyPort}/google`,
        OPENAI_BASE_URL: `http://localhost:${proxyPort}/openai/v1`,
        ANTHROPIC_BASE_URL: `http://localhost:${proxyPort}/anthropic`,
      },
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
    console.log(`[Bridge] Stopping all managed sessions...`);
    const stopPromises = [];
    for (const session of this.sessions.values()) {
      stopPromises.push(session.stop());
    }
    await Promise.all(stopPromises);
    this.sessions.clear();
  }
}
