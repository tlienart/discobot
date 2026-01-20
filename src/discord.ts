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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { readFileSync, existsSync } from 'fs';
import dotenv from 'dotenv';
import { SessionManager } from './sessions';
import { type OpenCodeEvent } from './opencode';
import { type Agent } from './agent';

dotenv.config();

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

  // Track if a channel is currently busy with a process
  private channelBusy: Set<string> = new Set();

  constructor() {
    this.token = process.env.DISCORD_TOKEN || '';
    this.clientId = process.env.DISCORD_CLIENT_ID || '';
    this.guildId = process.env.DISCORD_GUILD_ID || '';

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
      // Flatten prompt to single line and remove shell-unsafe characters
      const flattened = userPrompt.replace(/\n/g, ' ').replace(/\r/g, '');
      return `${flattened} [Instruction: Stay under 2000 chars, be concise, summarize raw data]`;
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

        case 'new': {
          const prompt = options.getString('prompt') || 'Hello! How can you help me today?';
          await interaction.deferReply();

          try {
            let parentId = this.sessionManager.getCategoryId();
            if (!parentId) {
              const currentChannel = await guild?.channels.fetch(channelId);
              if (currentChannel && 'parentId' in currentChannel && currentChannel.parentId) {
                parentId = currentChannel.parentId;
              }
            }

            const channel = await guild?.channels.create({
              name: `opencode-${Date.now().toString().slice(-4)}`,
              type: ChannelType.GuildText,
              parent: parentId || undefined,
            });

            if (channel) {
              const session = this.sessionManager.prepareSession(channel.id);
              this.attachSessionListeners(session, channel as TextChannel);

              const count = this.sessionManager.getNextSessionCount(channel.id);
              await interaction.editReply(`Created new session in ${channel}`);

              // Mirror user prompt
              await (channel as TextChannel).send(`**User:** ${prompt}`);
              await (channel as TextChannel).send(
                `🚀 **Agent is starting up... (Session #${count})**`,
              );

              this.channelBusy.add(channel.id);
              session.start(getDiscordPrompt(prompt)).finally(() => {
                this.channelBusy.delete(channel.id);
              });
            }
          } catch (error) {
            console.error('[Discord] Failed to create session:', error);
            await interaction.editReply('Failed to create session. Check bot permissions.');
          }
          break;
        }

        case 'test-bridge': {
          const message = options.getString('message') || 'Test bridge echo';
          await interaction.deferReply();

          try {
            let parentId = this.sessionManager.getCategoryId();
            if (!parentId) {
              const currentChannel = await guild?.channels.fetch(channelId);
              if (currentChannel && 'parentId' in currentChannel && currentChannel.parentId) {
                parentId = currentChannel.parentId;
              }
            }

            const channel = await guild?.channels.create({
              name: `test-${Date.now().toString().slice(-4)}`,
              type: ChannelType.GuildText,
              parent: parentId || undefined,
            });

            if (channel) {
              const session = this.sessionManager.prepareMockSession(channel.id);
              this.attachSessionListeners(session, channel as TextChannel);

              await interaction.editReply(`Created mock test session in ${channel}`);
              await (channel as TextChannel).send(`**User:** ${message}`);
              await (channel as TextChannel).send('🧪 **Mock bridge starting...**');

              this.channelBusy.add(channel.id);
              session.start(message).finally(() => {
                this.channelBusy.delete(channel.id);
              });
            }
          } catch (error) {
            console.error('[Discord] Failed to create mock session:', error);
            await interaction.editReply('Failed to create mock session.');
          }
          break;
        }

        case 'interrupt': {
          const session = this.sessionManager.getSession(channelId);
          if (session) {
            this.sessionManager.removeSession(channelId, true);
            this.channelBusy.delete(channelId);
            await interaction.reply('Current process killed!');
          } else {
            await interaction.reply({
              content: 'No active session in this channel',
              flags: [MessageFlags.Ephemeral],
            });
          }
          break;
        }

        case 'peek-log': {
          const session = this.sessionManager.getSession(channelId);
          if (session) {
            try {
              const stdoutPath = session.getStdoutPath();
              const stderrPath = session.getStderrPath();

              let content = '';
              if (existsSync(stdoutPath)) {
                const stdout = readFileSync(stdoutPath, 'utf-8');
                content += `**Stdout Peek:**\n\`\`\`\n${stdout.slice(-800)}\n\`\`\`\n`;
              }
              if (existsSync(stderrPath)) {
                const stderr = readFileSync(stderrPath, 'utf-8');
                content += `**Stderr Peek:**\n\`\`\`\n${stderr.slice(-800)}\n\`\`\`\n`;
              }

              await interaction.reply({
                content: content || 'Log files are empty.',
                flags: [MessageFlags.Ephemeral],
              });
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              await interaction.reply({
                content: `Failed to read logs: ${errorMessage}`,
                flags: [MessageFlags.Ephemeral],
              });
            }
          } else {
            await interaction.reply({
              content: 'No active session in this channel',
              flags: [MessageFlags.Ephemeral],
            });
          }
          break;
        }

        case 'reset': {
          this.channelBusy.delete(channelId);
          await interaction.reply({
            content: 'Successfully reset busy lock for this channel.',
            flags: [MessageFlags.Ephemeral],
          });
          break;
        }

        case 'debug': {
          const msgContentIntent = this.client.options.intents.has(
            GatewayIntentBits.MessageContent,
          );
          const categoryId = this.sessionManager.getCategoryId();

          await interaction.reply({
            content: `**Debug Info:**\n- Message Content Intent: ${msgContentIntent ? '✅ Enabled' : '❌ Disabled'}\n- Active Sessions: ${this.sessionManager.getChannelMapping().size}\n- Category Set: ${categoryId ? '✅' : '❌'}`,
            flags: [MessageFlags.Ephemeral],
          });
          break;
        }

        case 'restart': {
          const session = this.sessionManager.getSession(channelId);
          const type = this.sessionManager.getSessionType(channelId);

          if (!session || !type) {
            await interaction.reply({
              content: 'No active session in this channel to restart.',
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }

          const confirm = new ButtonBuilder()
            .setCustomId('confirm_restart')
            .setLabel('Restart (Wipe History)')
            .setStyle(ButtonStyle.Danger);

          const cancel = new ButtonBuilder()
            .setCustomId('cancel_restart')
            .setLabel('Keep Session')
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancel, confirm);

          const response = await interaction.reply({
            content: `⚠️ **Wipe conversation and start fresh?**\nThis will stop the current process and clear the memory for this channel.`,
            components: [row],
            flags: [MessageFlags.Ephemeral],
          });

          const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 30000,
          });

          collector.on('collect', async (i) => {
            if (i.customId === 'confirm_restart') {
              await i.update({
                content: '🔄 Wiping history and starting fresh...',
                components: [],
              });

              // Stop existing
              this.sessionManager.removeSession(channelId);
              this.channelBusy.delete(channelId);

              // Start new
              const count = this.sessionManager.getNextSessionCount(channelId);
              let newSession: Agent;
              if (type === 'mock') {
                newSession = this.sessionManager.prepareMockSession(channelId);
              } else {
                newSession = this.sessionManager.prepareSession(channelId);
              }

              const channel = await this.client.channels.fetch(channelId);
              if (channel && channel.type === ChannelType.GuildText) {
                this.attachSessionListeners(newSession, channel as TextChannel);
                await channel.send(`🚀 **Starting Fresh Session #${count}**`);

                this.channelBusy.add(channelId);
                newSession.start().finally(() => {
                  this.channelBusy.delete(channelId);
                });
              }
            } else {
              await i.update({ content: 'Restart cancelled.', components: [] });
            }
          });
          break;
        }

        case 'resume': {
          const sessionId = options.getString('session_id');
          if (!sessionId) {
            await interaction.reply({
              content: '❌ **Error**: Please provide a valid Session ID to resume.',
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }

          await interaction.deferReply();

          try {
            const existing = this.sessionManager.getSession(channelId);
            if (existing) {
              this.sessionManager.removeSession(channelId);
              this.channelBusy.delete(channelId);
            }

            const session = this.sessionManager.prepareSession(channelId, sessionId);
            this.attachSessionListeners(session, interaction.channel as TextChannel);

            const count = this.sessionManager.getNextSessionCount(channelId);
            const realId = (session as unknown as { sessionId?: string }).sessionId || sessionId;
            const alias = this.sessionManager.getAliasForSession(realId);
            const displayName = alias || sessionId.replace('ses_', '');

            await interaction.editReply(`Resuming session \`${displayName}\` in this channel.`);
            await (interaction.channel as TextChannel).send(
              `🔄 **Re-attaching to session #${count}... (Context restored)**`,
            );

            this.channelBusy.add(channelId);
            session.start().finally(() => {
              this.channelBusy.delete(channelId);
            });
          } catch (error) {
            console.error('[Discord] Failed to resume session:', error);
            await interaction.editReply('Failed to resume session.');
          }
          break;
        }
      }
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const session = this.sessionManager.getSession(message.channelId);
      const type = this.sessionManager.getSessionType(message.channelId);

      if (session) {
        if (this.channelBusy.has(message.channelId)) {
          if (typeof message.reply === 'function') {
            await message.reply(
              '⚠️ **Agent is currently busy. Please wait for the current task to finish.**',
            );
          }
          return;
        }

        console.log(
          `[Discord] Message in session channel ${message.channelId}: ${message.content}`,
        );
        try {
          await message.react('📥');
          const stableSessionId = this.sessionManager.getChannelMapping().get(message.channelId);

          // Mirror prompt
          if (message.channel instanceof TextChannel) {
            await message.channel.send(`**User:** ${message.content}`);
          }

          let freshSession: Agent;
          if (type === 'mock') {
            freshSession = this.sessionManager.prepareMockSession(
              message.channelId,
              stableSessionId,
            );
          } else {
            freshSession = this.sessionManager.prepareSession(message.channelId, stableSessionId);
          }

          this.attachSessionListeners(freshSession, message.channel as TextChannel);

          this.channelBusy.add(message.channelId);
          freshSession.start(getDiscordPrompt(message.content)).finally(() => {
            this.channelBusy.delete(message.channelId);
          });
        } catch (error) {
          console.error('[Discord] Failed to handle message:', error);
          await message.react('❌');
        }
      }
    });
  }

  private attachSessionListeners(session: Agent, channel: TextChannel) {
    let firstOutput = true;
    let sessionIdDiscovered = false;

    const cleanupThinking = async (immediate = false) => {
      // Clear current tool info immediately
      this.lastToolUsed.delete(channel.id);

      const performCleanup = async () => {
        const existingInterval = this.typingIntervals.get(channel.id);
        if (existingInterval) {
          clearInterval(existingInterval);
          this.typingIntervals.delete(channel.id);
        }
        const existingHeartbeat = this.heartbeatTimers.get(channel.id);
        if (existingHeartbeat) {
          clearInterval(existingHeartbeat);
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
        // Debounce cleanup for 2 seconds to prevent UI flicker
        const timer = setTimeout(performCleanup, 2000);
        this.cleanupTimers.set(channel.id, timer);
      }
    };

    session.on('event', (event: OpenCodeEvent) => {
      const sid = event.sessionID || event.part?.sessionID;
      if (sid && !sessionIdDiscovered) {
        sessionIdDiscovered = true;
        const alias = this.sessionManager.getAliasForSession(sid);
        const displayName = alias || sid.replace('ses_', '');
        channel.send(`🆔 **Session Name:** \`${displayName}\``).catch(console.error);
      }

      if (event.type === 'error') {
        const errorMsg =
          event.error?.message || event.error?.data?.message || 'Internal Agent Error';
        channel.send(`❌ **Agent Error:** ${errorMsg}`).catch(console.error);
      }

      // Track tool usage for heartbeat
      const toolName = event.part?.tool || event.tool;
      if (toolName) {
        this.lastToolUsed.set(channel.id, toolName);
      }
    });

    session.on('sandbox_violation', async (message: string) => {
      console.warn(`[Sandbox Violation] Channel ${channel.id}: ${message}`);
      const lastTool = this.lastToolUsed.get(channel.id);
      const toolInfo = lastTool ? ` while using **${lastTool}**` : '';

      await channel.send(
        `🛡️ **Sandbox Security Alert**\nAn action was blocked${toolInfo}:\n\`${message}\`\n\nThe process has been terminated for your safety. You can send a new prompt now.`,
      );

      await cleanupThinking(true);
      session.stop().catch(() => {});
    });

    session.on('output', async (text: string) => {
      if (firstOutput) {
        console.log(`[Discord] First output received for channel ${channel.id}`);
        firstOutput = false;
      }

      // Check for Discord character limit
      if (text.length > 1990 && !this.summarizingChannels.has(channel.id)) {
        console.log(
          `[Discord] Output too long (${text.length} chars) for ${channel.id}. Triggering silent summarization...`,
        );
        this.summarizingChannels.add(channel.id);
        await cleanupThinking(true);

        // Inform user in terminal
        console.log(`[Discord] Full output preserved in logs. Requesting summary...`);

        // Start a new agent turn for summarization
        const stableSessionId = this.sessionManager.getChannelMapping().get(channel.id);
        const freshSession = this.sessionManager.prepareSession(channel.id, stableSessionId);
        this.attachSessionListeners(freshSession, channel);

        this.channelBusy.add(channel.id);
        const summarizationPrompt =
          'The previous output was too long for the user interface. Please provide a concise summary of the key information provided in the previous step. Ensure the summary is under 1800 characters and maintains all essential facts, data, and formatting.';

        freshSession.start(summarizationPrompt).finally(() => {
          this.channelBusy.delete(channel.id);
          this.summarizingChannels.delete(channel.id);
        });
        return;
      }

      await cleanupThinking();
      // Log snippet to terminal
      const snippet = text.length > 50 ? text.substring(0, 47) + '...' : text;
      console.log(`[Discord] Sending output: ${snippet.replace(/\n/g, ' ')}`);
      channel.send(text).catch(console.error);
    });

    session.on('thinking', async (isThinking: boolean) => {
      if (isThinking) {
        // Cancel any pending cleanup
        const pendingCleanup = this.cleanupTimers.get(channel.id);
        if (pendingCleanup) {
          clearTimeout(pendingCleanup);
          this.cleanupTimers.delete(channel.id);
        }

        if (!this.typingIntervals.has(channel.id)) {
          channel.sendTyping().catch(console.error);
          const interval = setInterval(() => {
            channel.sendTyping().catch(console.error);
          }, 5000);
          this.typingIntervals.set(channel.id, interval);
        }

        if (!this.heartbeatTimers.has(channel.id)) {
          this.thinkingStartTimes.set(channel.id, Date.now());
          const heartbeat = setInterval(async () => {
            const startTime = this.thinkingStartTimes.get(channel.id);
            const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
            const isSummarizing = this.summarizingChannels.has(channel.id);
            const tool = this.lastToolUsed.get(channel.id);

            let statusText = isSummarizing ? 'Synthesizing summary' : 'Still thinking';
            if (tool) statusText += ` (Using ${tool})`;

            let msg = this.thinkingMessages.get(channel.id);
            if (!msg) {
              msg = await channel
                .send(`⏳ *${statusText}... (${elapsed}s elapsed)*`)
                .catch(() => undefined);
              if (msg) this.thinkingMessages.set(channel.id, msg);
            } else {
              await msg.edit(`⏳ *${statusText}... (${elapsed}s elapsed)*`).catch(() => {});
            }
          }, 10000); // 10 second frequency
          this.heartbeatTimers.set(channel.id, heartbeat);
        }
      } else {
        await cleanupThinking();
      }
    });

    session.on('heartbeat', (seconds: number) => {
      if (seconds === 10) {
        console.log(`[Discord] Long silence detected for ${channel.id} (${seconds}s)`);
      }
    });

    session.on('idle', () => {
      channel.send('✅ **Ready for input**').catch(console.error);
    });

    session.on('error', async (error: Error) => {
      console.error(`[Session Error] ${channel.id}:`, error);
      await cleanupThinking();
      channel
        .send(`❌ **Error:** ${error.message || 'Unknown error occurred'}`)
        .catch(console.error);
    });

    session.on('exit', async (code: number) => {
      await cleanupThinking();
      if (code !== 0 && code !== null) {
        channel.send(`⚠️ **Process exited with code ${code}**`).catch(console.error);

        // Peek at stderr file
        await new Promise((r) => setTimeout(r, 1000));
        if (typeof session.getStderrPath === 'function') {
          const stderrPath = session.getStderrPath();
          if (existsSync(stderrPath)) {
            const content = readFileSync(stderrPath, 'utf-8');
            if (content.trim()) {
              channel
                .send(`📋 **Final Stderr Peek:**\n\`\`\`\n${content.slice(-1000)}\n\`\`\``)
                .catch(console.error);
            }
          }
        }
      }
    });
  }

  async registerCommands() {
    const commands = [
      new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
      new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set the category for new session channels')
        .addChannelOption((option) =>
          option
            .setName('category')
            .setDescription('The category where sessions will be created')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName('new')
        .setDescription('Start a new OpenCode session')
        .addStringOption((option) =>
          option.setName('prompt').setDescription('Initial prompt for the agent'),
        ),
      new SlashCommandBuilder()
        .setName('test-bridge')
        .setDescription('Test the communication bridge with a mock uppercase agent')
        .addStringOption((option) =>
          option.setName('message').setDescription('Message to echo in uppercase'),
        ),
      new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume an existing session')
        .addStringOption((option) =>
          option
            .setName('session_id')
            .setDescription('The ID/Name of the session to resume')
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName('interrupt')
        .setDescription('Kill the current running process for this session'),
      new SlashCommandBuilder()
        .setName('peek-log')
        .setDescription('Peek at the raw stdout and stderr logs for this session'),
      new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Reset the busy lock for this channel if the agent is stuck'),
      new SlashCommandBuilder()
        .setName('debug')
        .setDescription('Show debug information about the bot status'),
      new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the session in this channel (wipe history)'),
    ].map((command) => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(this.token);

    try {
      console.log('Started refreshing application (/) commands.');

      await rest.put(Routes.applicationGuildCommands(this.clientId, this.guildId), {
        body: commands,
      });

      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error(error);
    }
  }

  async login() {
    const useSandbox = process.env.USE_SANDBOX === 'true';
    if (useSandbox) {
      console.log('[Sandbox] Initializing isolated environment...');
      const passList = [
        'GH_TOKEN',
        'GCLOUD_PROJECT',
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'GOOGLE_API_KEY',
      ];
      const activeSecrets = passList.filter((s) => !!process.env[s]);
      console.log(
        `[Sandbox] Active Secrets for Agent: ${activeSecrets.length > 0 ? activeSecrets.join(', ') : 'None'}`,
      );

      const expiry = Number(process.env.SESSION_EXPIRY_HOURS) || 48;
      this.sessionManager.pruneStaleSessions(expiry);
    }

    await this.client.login(this.token);
    await this.recoverSessions();
  }

  private async recoverSessions() {
    const mapping = this.sessionManager.getChannelMapping();
    if (mapping.size === 0) return;

    console.log(`Attempting to recover ${mapping.size} sessions...`);

    const channelIds = Array.from(mapping.keys());

    for (const channelId of channelIds) {
      const sessionId = mapping.get(channelId);
      if (!sessionId) continue;

      try {
        if (!/^\d{17,20}$/.test(channelId)) {
          this.sessionManager.removeSession(channelId);
          continue;
        }

        const channel = await this.client.channels.fetch(channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          console.log(`Recovering session ${sessionId} in channel ${channelId}`);
          this.sessionManager.prepareSession(channelId, sessionId);

          const count = this.sessionManager.getCurrentSessionCount(channelId);
          const alias = this.sessionManager.getAliasForSession(sessionId);
          const displayName = alias || sessionId.replace('ses_', '');
          await (channel as TextChannel).send(
            `🔄 **Bridge restarted. Ready to continue session #${count} (${displayName})...**`,
          );
        } else {
          this.sessionManager.removeSession(channelId);
        }
      } catch {
        this.sessionManager.removeSession(channelId);
      }
    }
  }

  getClient() {
    return this.client;
  }

  getCategoryId() {
    return this.sessionManager.getCategoryId();
  }

  getSessionManager() {
    return this.sessionManager;
  }
}
