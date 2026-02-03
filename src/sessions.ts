import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "bun";
import type { Agent } from "./agent";
import type { Config } from "./discord";
import { MockProcess } from "./mock";
import { OpenCodeAgent, type OpenCodeEvent } from "./opencode";

const ANIMALS = [
	"panda",
	"zebra",
	"koala",
	"otter",
	"tiger",
	"lion",
	"fox",
	"wolf",
	"bear",
	"deer",
	"eagle",
	"hawk",
	"owl",
	"swan",
	"duck",
	"crane",
	"frog",
	"toad",
	"newt",
	"crab",
	"whale",
	"shark",
	"seal",
	"walrus",
	"squid",
	"orca",
	"tuna",
	"pike",
	"bass",
	"carp",
	"cat",
	"dog",
	"horse",
	"sheep",
	"goat",
	"cow",
	"pig",
	"rabbit",
	"mouse",
	"rat",
	"bat",
	"bee",
	"ant",
	"wasp",
	"moth",
	"worm",
	"slug",
	"snail",
	"fly",
	"gnat",
	"hippo",
	"rhino",
	"parrot",
	"gecko",
	"falcon",
	"badger",
	"marmot",
	"lynx",
	"puma",
	"jaguar",
	"sloth",
	"lemur",
	"mole",
	"shrew",
	"vole",
	"elk",
	"moose",
	"bison",
	"camel",
	"llama",
	"albatross",
	"puffin",
	"pelican",
	"heron",
	"stork",
	"raven",
	"finch",
	"robin",
	"lark",
	"swift",
	"marlin",
	"salmon",
	"trout",
	"eel",
	"ray",
	"shrimp",
	"prawn",
	"lobster",
	"clam",
	"oyster",
	"beetle",
	"spider",
	"tick",
	"mite",
	"cicada",
	"cricket",
	"mantis",
	"wasp",
	"hornet",
	"wasp",
	"iguana",
	"turtle",
	"cobra",
	"viper",
	"python",
	"adder",
	"skink",
	"cobra",
	"anole",
	"sidewinder",
];

export interface SessionData {
	channels: Record<string, string>;
	categoryId: string | null;
	types: Record<string, "standard" | "mock">;
	sessionCounts: Record<string, number>;
	aliases: Record<string, string>;
	bindings: Record<string, string>;
	modes: Record<string, string>;
}

export class SessionManager {
	private sessions: Map<string, Agent> = new Map();
	private channelToSession: Map<string, string> = new Map();
	private channelToType: Map<string, "standard" | "mock"> = new Map();
	private channelToCount: Map<string, number> = new Map();
	private aliasToSession: Map<string, string> = new Map();
	private channelToBinding: Map<string, string> = new Map();
	private channelToMode: Map<string, string> = new Map();
	private categoryId: string | null = null;
	private readonly PERSISTENCE_FILE: string;
	private readonly workspacePath: string;
	private config: Config;

	constructor(config: Config) {
		this.config = config;
		this.PERSISTENCE_FILE = config.discord.sessionDb || "sessions.json";
		this.workspacePath =
			config.sandbox?.workspaceDir || join(process.cwd(), "workspace");

		if (!existsSync(this.workspacePath)) {
			mkdirSync(this.workspacePath, { recursive: true });
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
			modes: Object.fromEntries(this.channelToMode.entries()),
		};
		writeFileSync(this.PERSISTENCE_FILE, JSON.stringify(data, null, 2));
	}

	private loadPersistence() {
		if (existsSync(this.PERSISTENCE_FILE)) {
			try {
				const data = JSON.parse(readFileSync(this.PERSISTENCE_FILE, "utf-8"));
				if (data.channels)
					this.channelToSession = new Map(Object.entries(data.channels));
				if (data.types)
					this.channelToType = new Map(Object.entries(data.types));
				if (data.sessionCounts) {
					this.channelToCount = new Map(
						Object.entries(data.sessionCounts).map(([k, v]) => [k, Number(v)]),
					);
				}
				if (data.aliases)
					this.aliasToSession = new Map(Object.entries(data.aliases));
				if (data.bindings)
					this.channelToBinding = new Map(Object.entries(data.bindings));
				if (data.modes)
					this.channelToMode = new Map(Object.entries(data.modes));
				this.categoryId = data.categoryId || null;
			} catch {
				console.error("Failed to load persistence:");
			}
		}
	}

	setCategoryId(id: string | null) {
		if (id && !/^\d+$/.test(id)) {
			console.warn(`[Manager] Ignoring invalid category ID: ${id}`);
			this.categoryId = null;
		} else {
			this.categoryId = id;
		}
		this.savePersistence();
	}

	getCategoryId(): string | null {
		return this.categoryId;
	}

	getMode(channelId: string): string {
		return this.channelToMode.get(channelId) || "plan";
	}

	setMode(channelId: string, mode: string) {
		this.channelToMode.set(channelId, mode);
		this.savePersistence();
	}

	bindChannelToFolder(channelId: string, folderName: string) {
		const sanitized = folderName.replace(/[^a-zA-Z0-9._-]/g, "");
		if (!sanitized) throw new Error("Invalid folder name");
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
		return list[Math.floor(Math.random() * list.length)] || "agent";
	}

	resolveSessionId(input: string): string {
		const alias = this.aliasToSession.get(input);
		if (alias) return alias;
		if (input.startsWith("ses_")) return input;
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
		session.on("event", (event: OpenCodeEvent) => {
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

	private getSbxName(channelId: string): string {
		return `chan-${channelId}`;
	}

	private isSbxHealthy(sbxName: string): boolean {
		const sbxBin = join(process.cwd(), "sbx", "bin", "sbx");
		// Try to run a simple command to verify the sandbox is functional
		const result = spawnSync([sbxBin, "exec", sbxName, "--", "whoami"]);
		return result.exitCode === 0 && result.stdout.toString().includes(sbxName);
	}

	private ensureSbx(sbxName: string, retry = true) {
		if (this.isSbxHealthy(sbxName)) return;

		console.log(
			`[Manager] Sandbox ${sbxName} missing or unhealthy. Provisioning...`,
		);
		const sbxBin = join(process.cwd(), "sbx", "bin", "sbx");

		// First, try to delete it just in case it exists but is broken
		spawnSync([sbxBin, "delete", sbxName]);

		const result = spawnSync([
			sbxBin,
			"create",
			sbxName,
			"--tools",
			"gh,git,opencode",
		]);
		if (result.exitCode !== 0) {
			console.error(
				`[Manager] Failed to create sbx: ${result.stderr.toString()}`,
			);
			if (retry) {
				console.log("[Manager] Retrying sandbox creation...");
				this.ensureSbx(sbxName, false);
				return;
			}
			throw new Error(`Failed to create sandbox ${sbxName}`);
		}
	}

	prepareSession(channelId: string, sessionId?: string): Agent {
		const sid = sessionId
			? this.resolveSessionId(sessionId)
			: this.channelToSession.get(channelId);
		const sbxName = this.getSbxName(channelId);
		const useSandbox = this.config.sandbox?.enabled ?? true;

		if (useSandbox) {
			this.ensureSbx(sbxName);
		}

		const session = new OpenCodeAgent(sid, {
			workspacePath: this.workspacePath, // sbx handles its own home, but we can still pass this for reference if needed
			useSandbox: useSandbox,
			sbxName: sbxName,
			mode: this.getMode(channelId),
		});

		this.sessions.set(channelId, session);
		if (sid) this.channelToSession.set(channelId, sid);
		this.channelToType.set(channelId, "standard");
		this.savePersistence();
		this.attachIdListener(channelId, session);
		return session;
	}

	prepareMockSession(channelId: string, sessionId?: string): Agent {
		const sid = sessionId
			? this.resolveSessionId(sessionId)
			: `ses_${this.generateBotSessionId()}`;
		const session = new MockProcess(sid);
		this.sessions.set(channelId, session);
		this.channelToSession.set(channelId, sid);
		this.channelToType.set(channelId, "mock");
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

		const useSandbox = this.config.sandbox?.enabled ?? true;
		if (useSandbox && !keepMapping) {
			const sbxName = this.getSbxName(channelId);
			const sbxBin = join(process.cwd(), "sbx", "bin", "sbx");
			const listResult = spawnSync([sbxBin, "list"]);
			if (listResult.stdout.toString().includes(sbxName)) {
				console.log(`[Manager] Deleting sbx sandbox: ${sbxName}`);
				spawnSync([sbxBin, "delete", sbxName]);
			}
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
