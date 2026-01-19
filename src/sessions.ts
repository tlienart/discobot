import { OpenCodeAgent, type OpenCodeEvent } from './opencode';
import { MockProcess } from './mock';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { type Agent } from './agent';
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
  'hornet',
  'iguana',
  'turtle',
  'cobra',
  'viper',
  'python',
  'adder',
  'skink',
  'anole',
  'sidewinder',
];

export interface SessionData {
  channels: Record<string, string>;
  categoryId: string | null;
  types: Record<string, 'standard' | 'mock'>;
  sessionCounts: Record<string, number>;
  aliases: Record<string, string>;
  lastUsed: Record<string, number>;
}

export class SessionManager {
  private sessions: Map<string, Agent> = new Map();
  private channelToSession: Map<string, string> = new Map();
  private channelToType: Map<string, 'standard' | 'mock'> = new Map();
  private channelToCount: Map<string, number> = new Map();
  private aliasToSession: Map<string, string> = new Map();
  private channelToLastUsed: Map<string, number> = new Map();
  private categoryId: string | null = null;
  private readonly PERSISTENCE_FILE: string;

  constructor(persistenceFile: string = 'sessions.json') {
    this.PERSISTENCE_FILE = persistenceFile;
    this.loadPersistence();
  }

  private savePersistence() {
    const data: SessionData = {
      channels: Object.fromEntries(this.channelToSession.entries()),
      categoryId: this.categoryId,
      types: Object.fromEntries(this.channelToType.entries()),
      sessionCounts: Object.fromEntries(this.channelToCount.entries()),
      aliases: Object.fromEntries(this.aliasToSession.entries()),
      lastUsed: Object.fromEntries(this.channelToLastUsed.entries()),
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
        if (data.lastUsed) {
          this.channelToLastUsed = new Map(
            Object.entries(data.lastUsed).map(([k, v]) => [k, Number(v)]),
          );
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
    if (this.aliasToSession.has(input)) {
      return this.aliasToSession.get(input)!;
    }
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
    const session = new OpenCodeAgent(sid);
    this.sessions.set(channelId, session);

    if (sid) {
      this.channelToSession.set(channelId, sid);
    }
    this.channelToType.set(channelId, 'standard');
    this.channelToLastUsed.set(channelId, Date.now());
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
    this.channelToLastUsed.set(channelId, Date.now());
    this.savePersistence();
    return session;
  }

  getChannelMapping() {
    return this.channelToSession;
  }

  getSession(channelId: string): Agent | undefined {
    if (this.sessions.has(channelId)) {
      this.channelToLastUsed.set(channelId, Date.now());
      this.savePersistence();
    }
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
      this.channelToLastUsed.delete(channelId);
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

  pruneStaleSessions(expiryHours: number = 48) {
    const now = Date.now();
    const expiryMs = expiryHours * 60 * 60 * 1000;
    const startTime = Date.now();
    let prunedCount = 0;

    console.log(`[Sandbox] Starting GC sweep (TTL: ${expiryHours}h)...`);

    for (const [channelId, lastUsed] of this.channelToLastUsed.entries()) {
      if (now - lastUsed > expiryMs) {
        const sessionId = this.channelToSession.get(channelId);
        if (sessionId) {
          console.log(`[Sandbox] Pruning stale session ${sessionId} for channel ${channelId}`);
          this.channelToSession.delete(channelId);
          this.channelToType.delete(channelId);
          this.channelToCount.delete(channelId);
          this.channelToLastUsed.delete(channelId);
          prunedCount++;
        }
      }
    }

    if (existsSync('logs')) {
      const logs = readdirSync('logs');
      for (const log of logs) {
        const path = join('logs', log);
        const stats = statSync(path);
        if (now - stats.mtimeMs > expiryMs) {
          try {
            unlinkSync(path);
          } catch {
            // Ignore deletion errors
          }
        }
      }
    }

    const sandboxData = process.env.SANDBOX_WORKSPACE_DIR || './workspace';
    const sessionDbPath = join(sandboxData, '.opencode/data/opencode/session');
    if (existsSync(sessionDbPath)) {
      const sessions = readdirSync(sessionDbPath);
      for (const sessionDir of sessions) {
        const path = join(sessionDbPath, sessionDir);
        const stats = statSync(path);
        if (now - stats.mtimeMs > expiryMs) {
          try {
            rmSync(path, { recursive: true, force: true });
          } catch {
            // Ignore deletion errors
          }
        }
      }
    }

    this.savePersistence();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[Sandbox] GC sweep completed. Pruned ${prunedCount} stale entries in ${duration}s.`,
    );
  }
}
