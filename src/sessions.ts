import { OpenCodeAgent, type OpenCodeEvent } from './opencode';
import { MockProcess } from './mock';
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
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
}

export class SessionManager {
  private sessions: Map<string, Agent> = new Map();
  private channelToSession: Map<string, string> = new Map();
  private channelToType: Map<string, 'standard' | 'mock'> = new Map();
  private channelToCount: Map<string, number> = new Map();
  private aliasToSession: Map<string, string> = new Map();
  private categoryId: string | null = null;
  private readonly PERSISTENCE_FILE: string;
  private sandboxManager: SandboxManager | null = null;
  private readonly workspacePath: string;

  constructor(persistenceFile: string = 'sessions.json') {
    this.PERSISTENCE_FILE = persistenceFile;

    const configWorkspace = process.env.SANDBOX_WORKSPACE_DIR || './workspace';
    if (configWorkspace.startsWith('./') || !configWorkspace.startsWith('/')) {
      if (process.env.USE_SANDBOX === 'true') {
        // Use /Users/Shared for sandbox to avoid permission issues with home dir
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

      // Setup shims for the sandbox user
      // Assuming the sandbox user's bin dir is accessible or we put it in workspace
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
    };
    writeFileSync(this.PERSISTENCE_FILE, JSON.stringify(data, null, 2));
  }

  private loadPersistence() {
    if (existsSync(this.PERSISTENCE_FILE)) {
      try {
        const data = JSON.parse(readFileSync(this.PERSISTENCE_FILE, 'utf-8'));
        if (data.channels) {
          this.channelToSession = new Map(Object.entries(data.channels));
        }
        if (data.types) {
          this.channelToType = new Map(Object.entries(data.types));
        }
        if (data.sessionCounts) {
          this.channelToCount = new Map(
            Object.entries(data.sessionCounts).map(([k, v]) => [k, Number(v)]),
          );
        }
        if (data.aliases) {
          this.aliasToSession = new Map(Object.entries(data.aliases));
        }
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

  generateBotSessionId(): string {
    const unusedAnimals = ANIMALS.filter((a) => !this.aliasToSession.has(a));
    const list = unusedAnimals.length > 0 ? unusedAnimals : ANIMALS;
    const animal = list[Math.floor(Math.random() * list.length)] || 'agent';
    return animal;
  }

  resolveSessionId(input: string): string {
    // If it's an alias, return the real ID
    if (this.aliasToSession.has(input)) {
      return this.aliasToSession.get(input)!;
    }
    // Otherwise, ensure it has the 'ses_' prefix
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
          console.log(`[Manager] Captured Session ID for channel ${channelId}: ${sid}`);
          this.channelToSession.set(channelId, sid);

          // If this session doesn't have an alias yet, assign a new one
          if (!this.getAliasForSession(sid)) {
            const alias = this.generateBotSessionId();
            console.log(`[Manager] Assigning alias '${alias}' to session ${sid}`);
            this.setAlias(alias, sid);
          }

          this.savePersistence();
        }
      }
    });
  }

  prepareSession(channelId: string, sessionId?: string): Agent {
    const sid = sessionId ? this.resolveSessionId(sessionId) : undefined;

    // Determine the workspace for this session
    const sessionWorkspace = sid
      ? join(this.workspacePath, sid)
      : join(this.workspacePath, `temp_${Date.now()}`);
    if (!existsSync(sessionWorkspace)) {
      mkdirSync(sessionWorkspace, { recursive: true });
      chmodSync(sessionWorkspace, 0o777);
    }

    const session = new OpenCodeAgent(sid, {
      workspacePath: sessionWorkspace,
      useSandbox: process.env.USE_SANDBOX === 'true',
      sandboxBinDir: join(this.workspacePath, '.bin'),
    });
    this.sessions.set(channelId, session);

    if (sid) {
      this.channelToSession.set(channelId, sid);
    }
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
