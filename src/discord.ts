import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  ChannelType,
  type Message,
  MessageFlags,
} from 'discord.js';
import { readFileSync, existsSync } from 'fs';
import { SessionManager } from './sessions';
import { type OpenCodeEvent } from './opencode';
import { type Agent } from './agent';
import { join } from 'path';

export interface Config {
  discord: {
    token: string;
    clientId: string;
    guildId: string;
    sessionDb: string;
  };
  sandbox: {
    enabled: boolean;
    workspaceDir: string;
    sandboxGhToken: string;
    opencodeConfigPath: string;
  };
  gcp?: {
    project: string;
  };
  apiKeys?: {
    google?: string;
    openai?: string;
    anthropic?: string;
  };
}

export class DiscordClient {
  private client: Client;
  private config: Config;
  private sessionManager: SessionManager;

  private typingIntervals: Map<string, Timer> = new Map();
  private heartbeatTimers: Map<string, Timer> = new Map();
  private thinkingMessages: Map<string, Message> = new Map();
  private thinkingStartTimes: Map<string, number> = new Map();
  private summarizingChannels: Set<string> = new Set();
  private lastToolUsed: Map<string, string> = new Map();
  private cleanupTimers: Map<string, Timer> = new Map();

  private channelBusy: Set<string> = new Set();

  constructor(config?: Config) {
    if (config) {
      this.config = config;
    } else {
      const configPath = join(process.cwd(), 'config.json');
      if (!existsSync(configPath)) {
        throw new Error('Missing config.json file');
      }

      try {
        this.config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch (e) {
        throw new Error(`Failed to parse config.json: ${String(e)}`);
      }
    }

    const { token, clientId, guildId } = this.config.discord;

    if (token) {
      console.log(
        `[Discord] Token loaded. Length: ${token.length}, Prefix: ${token.substring(0, 4)}...`,
      );
    }

    if (!token || !clientId || !guildId) {
      throw new Error('Missing Discord credentials in config.json');
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.sessionManager = new SessionManager(this.config);
    this.setupEvents();
  }

  private setupEvents() {
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    });

    const getDiscordPrompt = (userPrompt: string) => {
      // Flatten prompt to single line and remove characters that trigger shell syntax errors
      const flattened = userPrompt
        .replace(/\n/g, ' ')
        .replace(/\r/g, '')
        .replace(/['"()[\]{}|&;$<>\\]/g, '');

      const instruction =
        'Be concise and stay under 1800 chars. You are in a secure sandbox. Always use relative paths within the workspace.';
      return `${flattened} Instruction: ${instruction}`;
    };

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const { commandName, options, channelId, guild } = interaction;

      switch (commandName) {
        case 'ping':
          await interaction.reply('Pong!');
          break;

        case 'setup': {
          const category = options.getChannel('category');
          if (category && category.type === ChannelType.GuildCategory) {
            this.sessionManager.setCategoryId(category.id);
            await interaction.reply({
              content: `Successfully set session category to: **${category.name}** (${category.id})`,
              flags: [MessageFlags.Ephemeral],
            });
          } else {
            await interaction.reply({
              content: 'Please provide a valid category.',
              flags: [MessageFlags.Ephemeral],
            });
          }
          break;
        }

        case 'bind': {
          const folder = options.getString('folder');
          if (!folder) {
            await interaction.reply({
              content: '❌ Folder name required.',
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }
          try {
            const sanitized = this.sessionManager.bindChannelToFolder(channelId, folder);
            await interaction.reply({
              content: `✅ Bound to workspace folder: \`${sanitized}\``,
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            await interaction.reply({
              content: `❌ Error: ${msg}`,
              flags: [MessageFlags.Ephemeral],
            });
          }
          break;
        }

        case 'new': {
          const name = options.getString('name');
          if (!name) {
            await interaction.reply({
              content: '❌ Name required.',
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }

          const sanitized = name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .substring(0, 100);
          await interaction.deferReply();

          try {
            let parentId = this.sessionManager.getCategoryId();

            if (parentId && !/^\d+$/.test(parentId)) {
              this.sessionManager.setCategoryId(null);
              parentId = null;
            }

            if (guild) {
              const channels = await guild.channels.fetch();

              // @ts-expect-error - Collection.find
              const existing = channels.find(
                (c) => c?.name === sanitized && c?.type === ChannelType.GuildText,
              );
              if (existing) {
                await interaction.editReply(`❌ Error: Channel \`#${sanitized}\` already exists.`);
                return;
              }

              let category = parentId ? channels.get(parentId) : null;
              if (!category || category.type !== ChannelType.GuildCategory) {
                // @ts-expect-error - Collection.find
                category = channels.find(
                  (c) =>
                    c?.type === ChannelType.GuildCategory &&
                    c.name.toLowerCase().includes('opencode'),
                );
                if (category) {
                  parentId = category.id;
                  this.sessionManager.setCategoryId(parentId);
                } else {
                  category = await guild.channels.create({
                    name: 'OpenCode Sessions',
                    type: ChannelType.GuildCategory,
                  });
                  this.sessionManager.setCategoryId(category.id);
                  parentId = category.id;
                }
              }
            }

            const channel = await guild?.channels.create({
              name: sanitized,
              type: ChannelType.GuildText,
              parent: parentId || undefined,
            });

            if (channel) {
              this.sessionManager.bindChannelToFolder(channel.id, sanitized);
              const session = this.sessionManager.prepareSession(channel.id);
              this.attachSessionListeners(session, channel as TextChannel);
              await interaction.editReply(`Created session in ${channel}`);
            }
          } catch (error) {
            console.error(error);
            await interaction.editReply('Failed to create channel.');
          }
          break;
        }

        case 'attach': {
          await interaction.deferReply();
          try {
            const channel = await guild?.channels.fetch(channelId);
            if (channel && channel.type === ChannelType.GuildText) {
              const sanitized = channel.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
              this.sessionManager.bindChannelToFolder(channel.id, sanitized);
              const session = this.sessionManager.prepareSession(channel.id);
              this.attachSessionListeners(session, channel as TextChannel);
              await interaction.editReply(
                `✅ Attached OpenCode session to \`#${channel.name}\` (Workspace: \`${sanitized}\`)`,
              );
            }
          } catch {
            await interaction.editReply('❌ Failed to attach session.');
          }
          break;
        }

        case 'interrupt': {
          const session = this.sessionManager.getSession(channelId);
          if (session) {
            this.sessionManager.removeSession(channelId, true);
            this.channelBusy.delete(channelId);
            await interaction.reply('Process killed.');
          } else {
            await interaction.reply({
              content: 'No active session.',
              flags: [MessageFlags.Ephemeral],
            });
          }
          break;
        }

        case 'peek-log': {
          const session = this.sessionManager.getSession(channelId);
          if (session) {
            const stdout = existsSync(session.getStdoutPath())
              ? readFileSync(session.getStdoutPath(), 'utf-8')
              : '';
            const stderr = existsSync(session.getStderrPath())
              ? readFileSync(session.getStderrPath(), 'utf-8')
              : '';
            await interaction.reply({
              content: `**Stdout:**\n\`\`\`\n${stdout.slice(-800)}\n\`\`\`\n**Stderr:**\n\`\`\`\n${stderr.slice(-800)}\n\`\`\``,
              flags: [MessageFlags.Ephemeral],
            });
          }
          break;
        }

        case 'restart': {
          const session = this.sessionManager.getSession(channelId);
          if (!session) {
            await interaction.reply({
              content: 'No session to restart.',
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }
          this.sessionManager.removeSession(channelId);
          this.channelBusy.delete(channelId);
          const newSession = this.sessionManager.prepareSession(channelId);
          const chan = await this.client.channels.fetch(channelId);
          if (chan && chan.type === ChannelType.GuildText) {
            this.attachSessionListeners(newSession, chan as TextChannel);
            await (chan as TextChannel).send(`🔄 **Session Restarted.**`);
            this.channelBusy.add(channelId);
            newSession.start().finally(() => this.channelBusy.delete(channelId));
            await interaction.reply({ content: 'Restarting...', flags: [MessageFlags.Ephemeral] });
          }
          break;
        }

        case 'resume': {
          const sessionId = options.getString('session_id');
          if (!sessionId) {
            await interaction.reply({
              content: 'Session ID required.',
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }
          await interaction.deferReply();
          try {
            this.sessionManager.removeSession(channelId);
            const session = this.sessionManager.prepareSession(channelId, sessionId);
            this.attachSessionListeners(session, interaction.channel as TextChannel);
            await interaction.editReply(`Resumed \`${sessionId}\`.`);
            this.channelBusy.add(channelId);
            session.start().finally(() => this.channelBusy.delete(channelId));
          } catch {
            await interaction.editReply('Failed.');
          }
          break;
        }
      }
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;
      const session = this.sessionManager.getSession(message.channelId);
      if (session) {
        if (this.channelBusy.has(message.channelId)) {
          await message.reply('⚠️ Busy...').catch(() => {});
          return;
        }
        try {
          await message.react('📥');
          const sid = this.sessionManager.getChannelMapping().get(message.channelId);
          if (message.channel instanceof TextChannel) {
            await message.channel.send(`**User:** ${message.content}`);
          }
          const fresh = this.sessionManager.prepareSession(message.channelId, sid);
          this.attachSessionListeners(fresh, message.channel as TextChannel);
          this.channelBusy.add(message.channelId);
          fresh
            .start(getDiscordPrompt(message.content))
            .finally(() => this.channelBusy.delete(message.channelId));
        } catch {
          await message.react('❌');
        }
      }
    });
  }

  private attachSessionListeners(session: Agent, channel: TextChannel) {
    let firstOutput = true;
    let sessionIdDiscovered = false;

    const cleanupThinking = async (immediate = false) => {
      this.lastToolUsed.delete(channel.id);

      const performCleanup = async () => {
        const interval = this.typingIntervals.get(channel.id);
        if (interval) {
          clearInterval(interval);
          this.typingIntervals.delete(channel.id);
        }
        const hb = this.heartbeatTimers.get(channel.id);
        if (hb) {
          clearInterval(hb);
          this.heartbeatTimers.delete(channel.id);
        }
        const msg = this.thinkingMessages.get(channel.id);
        if (msg) {
          await msg.delete().catch(() => {});
          this.thinkingMessages.delete(channel.id);
        }
        this.thinkingStartTimes.delete(channel.id);
        this.cleanupTimers.delete(channel.id);
      };

      if (immediate) {
        await performCleanup();
      } else {
        const timer = setTimeout(performCleanup, 2000);
        this.cleanupTimers.set(channel.id, timer);
      }
    };

    session.on('event', (event: OpenCodeEvent) => {
      const sid = event.sessionID || event.part?.sessionID;
      if (sid && !sessionIdDiscovered) {
        sessionIdDiscovered = true;
        const alias = this.sessionManager.getAliasForSession(sid);
        channel.send(`🆔 **Session:** \`${alias || sid.replace('ses_', '')}\``).catch(() => {});
      }

      if (event.type === 'error') {
        const errorMsg =
          event.error?.message || event.error?.data?.message || 'Internal Agent Error';
        channel.send(`❌ **Agent Error:** ${errorMsg}`).catch(() => {});
      }

      const toolName = event.part?.tool || event.tool;
      if (toolName) {
        this.lastToolUsed.set(channel.id, toolName);
        if (event.part?.state?.status === 'failed') {
          const error = event.part.state.error || 'Unknown tool error';
          channel.send(`⚠️ **Tool Failed** (${toolName}): \`${error}\``).catch(() => {});
        }
      }
    });

    session.on('output', async (text: string) => {
      if (firstOutput) firstOutput = false;

      // Check for Discord character limit
      if (text.length > 1900 && !this.summarizingChannels.has(channel.id)) {
        this.summarizingChannels.add(channel.id);
        await cleanupThinking(true);

        const sid = this.sessionManager.getChannelMapping().get(channel.id);
        const fresh = this.sessionManager.prepareSession(channel.id, sid);
        this.attachSessionListeners(fresh, channel);
        this.channelBusy.add(channel.id);

        const prompt =
          'The previous output was too long. Please provide a concise summary under 1800 chars.';
        fresh.start(prompt).finally(() => {
          this.channelBusy.delete(channel.id);
          this.summarizingChannels.delete(channel.id);
        });
        return;
      }

      await cleanupThinking();
      if (text.length > 1900) {
        channel.send(text.substring(0, 1900) + '... (truncated)').catch(() => {});
      } else {
        channel.send(text).catch(() => {});
      }
    });

    session.on('thinking', async (isThinking: boolean) => {
      if (isThinking) {
        const pending = this.cleanupTimers.get(channel.id);
        if (pending) {
          clearTimeout(pending);
          this.cleanupTimers.delete(channel.id);
        }

        if (!this.typingIntervals.has(channel.id)) {
          channel.sendTyping().catch(() => {});
          const interval = setInterval(() => channel.sendTyping().catch(() => {}), 5000);
          this.typingIntervals.set(channel.id, interval);
        }

        if (!this.heartbeatTimers.has(channel.id)) {
          this.thinkingStartTimes.set(channel.id, Date.now());
          const heartbeat = setInterval(async () => {
            const startTime = this.thinkingStartTimes.get(channel.id);
            const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
            const isSummarizing = this.summarizingChannels.has(channel.id);
            const tool = this.lastToolUsed.get(channel.id);

            let statusText = isSummarizing ? 'Summarizing' : 'Thinking';
            if (tool) statusText += ` (Using ${tool})`;

            let msg = this.thinkingMessages.get(channel.id);
            if (!msg) {
              msg = await channel
                .send(`⏳ *${statusText}... (${elapsed}s)*`)
                .catch(() => undefined);
              if (msg) this.thinkingMessages.set(channel.id, msg);
            } else {
              await msg.edit(`⏳ *${statusText}... (${elapsed}s)*`).catch(() => {});
            }
          }, 10000);
          this.heartbeatTimers.set(channel.id, heartbeat);
        }
      } else {
        const timer = setTimeout(cleanupThinking, 2000);
        this.cleanupTimers.set(channel.id, timer);
      }
    });

    session.on('idle', () => channel.send('✅').catch(() => {}));
    session.on('error', (err) => {
      cleanupThinking(true);
      channel.send(`❌ ${err.message}`).catch(() => {});
    });
    session.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        cleanupThinking(true);
        channel.send(`⚠️ Exit ${code}`).catch(() => {});
      }
    });
  }

  async registerCommands() {
    const commands = [
      new SlashCommandBuilder().setName('ping').setDescription('Pong!'),
      new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup category')
        .addChannelOption((o) =>
          o
            .setName('category')
            .setDescription('Category')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName('new')
        .setDescription('New session')
        .addStringOption((o) => o.setName('name').setDescription('Channel Name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('attach')
        .setDescription('Attach OpenCode session to current channel'),
      new SlashCommandBuilder().setName('interrupt').setDescription('Kill process'),
      new SlashCommandBuilder().setName('peek-log').setDescription('Show logs'),
      new SlashCommandBuilder().setName('restart').setDescription('Restart session'),
      new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume session')
        .addStringOption((o) => o.setName('session_id').setDescription('ID').setRequired(true)),
      new SlashCommandBuilder()
        .setName('bind')
        .setDescription('Bind folder')
        .addStringOption((o) => o.setName('folder').setDescription('Folder').setRequired(true)),
    ].map((c) => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(this.config.discord.token);
    try {
      await rest.put(
        Routes.applicationGuildCommands(this.config.discord.clientId, this.config.discord.guildId),
        {
          body: commands,
        },
      );
      console.log('Reloaded (/) commands.');
    } catch (error) {
      console.error(error);
    }
  }

  async login() {
    await this.client.login(this.config.discord.token);
    await this.recoverSessions();
  }

  private async recoverSessions() {
    const mapping = this.sessionManager.getChannelMapping();
    for (const [channelId, sessionId] of mapping.entries()) {
      try {
        if (!/^\d{17,20}$/.test(channelId)) {
          this.sessionManager.removeSession(channelId);
          continue;
        }
        const channel = await this.client.channels.fetch(channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          this.sessionManager.prepareSession(channelId, sessionId);
          await (channel as TextChannel).send(`🔄 **Ready.**`);
        }
      } catch {
        /* ignore */
      }
    }
  }

  getClient() {
    return this.client;
  }
  getSessionManager() {
    return this.sessionManager;
  }
}
