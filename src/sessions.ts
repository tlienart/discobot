import { OpenCodeProcess, OneShotOpenCodeProcess, type OpenCodeEvent } from './opencode';
import { MockProcess } from './mock';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { type Agent } from './agent';

export interface SessionData {
  channels: Record<string, string>;
  categoryId: string | null;
  types: Record<string, 'persistent' | 'oneshot' | 'mock'>;
}

export class SessionManager {
  private sessions: Map<string, Agent> = new Map();
  private channelToSession: Map<string, string> = new Map();
  private channelToType: Map<string, 'persistent' | 'oneshot' | 'mock'> = new Map();
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
    // Strictly must start with 'ses' for OpenCode Zod validation
    return `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  private ensurePrefix(sid: string): string {
    if (sid.startsWith('ses')) return sid;
    return `ses_${sid}`;
  }

  private attachIdListener(channelId: string, session: Agent) {
    session.on('event', (event: OpenCodeEvent) => {
      const sid = event.sessionID || event.part?.sessionID;
      if (sid) {
        const currentSid = this.channelToSession.get(channelId);
        if (currentSid !== sid) {
          console.log(`[Manager] Captured Session ID for channel ${channelId}: ${sid}`);
          this.channelToSession.set(channelId, sid);
          this.savePersistence();
        }
      }
    });
  }

  prepareSession(channelId: string, sessionId?: string): Agent {
    const sid = sessionId ? this.ensurePrefix(sessionId) : this.generateBotSessionId();
    const session = new OpenCodeProcess(sid);
    this.sessions.set(channelId, session);
    this.channelToSession.set(channelId, sid);
    this.channelToType.set(channelId, 'persistent');
    this.savePersistence();
    
    this.attachIdListener(channelId, session);
    return session;
  }

  prepareOneShotSession(channelId: string, sessionId?: string): Agent {
    const sid = sessionId ? this.ensurePrefix(sessionId) : this.generateBotSessionId();
    const session = new OneShotOpenCodeProcess(sid);
    this.sessions.set(channelId, session);
    this.channelToSession.set(channelId, sid);
    this.channelToType.set(channelId, 'oneshot');
    this.savePersistence();

    this.attachIdListener(channelId, session);
    return session;
  }

  prepareMockSession(channelId: string, sessionId?: string): Agent {
    const sid = sessionId ? this.ensurePrefix(sessionId) : this.generateBotSessionId();
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

  removeSession(channelId: string) {
    const session = this.sessions.get(channelId);
    if (session) {
      session.stop();
      this.sessions.delete(channelId);
    }
    if (this.channelToSession.has(channelId)) {
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
