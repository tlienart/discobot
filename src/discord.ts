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

export class DiscordClient {
  private client: Client;
  private token: string;
  private clientId: string;
  private guildId: string;
  private sessionManager: SessionManager;

  private typingIntervals: Map<string, Timer> = new Map();
  private heartbeatTimers: Map<string, Timer> = new Map();
  private thinkingMessages: Map<string, Message> = new Map();
  private thinkingStartTimes: Map<string, number> = new Map();
  private summarizingChannels: Set<string> = new Set();
  private lastToolUsed: Map<string, string> = new Map();
  private cleanupTimers: Map<string, Timer> = new Map();

  private channelBusy: Set<string> = new Set();

  constructor() {
    this.token = (process.env.DISCORD_TOKEN || '').trim().replace(/^"|"$/g, '');
    this.clientId = (process.env.DISCORD_CLIENT_ID || '').trim().replace(/^"|"$/g, '');
    this.guildId = (process.env.DISCORD_GUILD_ID || '').trim().replace(/^"|"$/g, '');

    if (this.token) {
      console.log(
        `[Discord] Token loaded. Length: ${this.token.length}, Prefix: ${this.token.substring(0, 4)}...`,
      );
    } else {
      console.error('[Discord] Token is EMPTY!');
    }

    if (!this.token || !this.clientId || !this.guildId) {
      throw new Error('Missing Discord credentials in environment variables');
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.sessionManager = new SessionManager(process.env.SESSION_DB);
    this.setupEvents();
  }

  private setupEvents() {
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    });

    const getDiscordPrompt = (userPrompt: string) => {
      return `${userPrompt}\n\nIMPORTANT: Your response will be displayed on Discord (2000 character limit). Please be concise and summarize large amounts of data. Do not provide raw data dumps.`;
    };

    this.client.on(Events.InteractionCreate, async (interaction) => {
      console.log(
        `[Discord] Interaction received: ${interaction.isChatInputCommand() ? 'Slash Command' : 'Other'}`,
      );
      if (!interaction.isChatInputCommand()) return;

      const { commandName, options, channelId, guild } = interaction;
      console.log(`[Discord] Command: ${commandName}`);

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
            await interaction.reply({
              content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
              flags: [MessageFlags.Ephemeral],
            });
          }
          break;
        }

        case 'new': {
          const prompt = options.getString('prompt') || 'Hello!';
          await interaction.deferReply();
          try {
            let parentId = this.sessionManager.getCategoryId();
            if (!parentId && guild) {
              const channels = await guild.channels.fetch();
              // @ts-expect-error - fetch() returns a Collection
              const category = channels.find(
                (c) =>
                  c?.type === ChannelType.GuildCategory &&
                  c.name.toLowerCase().includes('opencode'),
              );
              if (category) {
                parentId = category.id;
              } else {
                const newCategory = await guild.channels.create({
                  name: 'OpenCode Sessions',
                  type: ChannelType.GuildCategory,
                });
                this.sessionManager.setCategoryId(newCategory.id);
                parentId = newCategory.id;
              }
            }
            const channel = await guild?.channels.create({
              name: `agent-${Date.now().toString().slice(-4)}`,
              type: ChannelType.GuildText,
              parent: parentId || undefined,
            });
            if (channel) {
              const session = this.sessionManager.prepareSession(channel.id);
              this.attachSessionListeners(session, channel as TextChannel);
              await interaction.editReply(`Created session in ${channel}`);
              await (channel as TextChannel).send(`**User:** ${prompt}`);
              this.channelBusy.add(channel.id);
              session
                .start(getDiscordPrompt(prompt))
                .finally(() => this.channelBusy.delete(channel.id));
            }
          } catch (error) {
            console.error(error);
            await interaction.editReply('Failed to create channel.');
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
            await (chan as TextChannel).send(`🔄 **Restarted.**`);
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
              content: 'ID required.',
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
          } catch (error) {
            console.error(error);
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
        } catch (error) {
          console.error(error);
          await message.react('❌');
        }
      }
    });
  }

  private attachSessionListeners(session: Agent, channel: TextChannel) {
    let firstOutput = true;
    let sessionIdDiscovered = false;

    const cleanupThinking = async () => {
      this.lastToolUsed.delete(channel.id);
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
    };

    session.on('event', (event: OpenCodeEvent) => {
      const sid = event.sessionID || event.part?.sessionID;
      if (sid && !sessionIdDiscovered) {
        sessionIdDiscovered = true;
        const alias = this.sessionManager.getAliasForSession(sid);
        channel.send(`🆔 **Session:** \`${alias || sid.replace('ses_', '')}\``).catch(() => {});
      }
      const tool = event.part?.tool || event.tool;
      if (tool) this.lastToolUsed.set(channel.id, tool);
    });

    session.on('output', async (text: string) => {
      if (firstOutput) firstOutput = false;
      await cleanupThinking();
      if (text.length > 1900) {
        channel.send(text.substring(0, 1900) + '... (truncated)').catch(() => {});
      } else {
        channel.send(text).catch(() => {});
      }
    });

    session.on('thinking', async (isThinking: boolean) => {
      if (isThinking) {
        if (!this.typingIntervals.has(channel.id)) {
          channel.sendTyping().catch(() => {});
          const interval = setInterval(() => channel.sendTyping().catch(() => {}), 5000);
          this.typingIntervals.set(channel.id, interval);
        }
      } else {
        await cleanupThinking();
      }
    });

    session.on('idle', () => channel.send('✅').catch(() => {}));
    session.on('error', (err) => channel.send(`❌ ${err.message}`).catch(() => {}));
    session.on('exit', (code) => {
      if (code !== 0 && code !== null) channel.send(`⚠️ Exit ${code}`).catch(() => {});
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
        .addStringOption((o) => o.setName('prompt').setDescription('Prompt')),
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

    const rest = new REST({ version: '10' }).setToken(this.token);
    try {
      await rest.put(Routes.applicationGuildCommands(this.clientId, this.guildId), {
        body: commands,
      });
      console.log('Reloaded (/) commands.');
    } catch (error) {
      console.error(error);
    }
  }

  async login() {
    await this.client.login(this.token);
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
