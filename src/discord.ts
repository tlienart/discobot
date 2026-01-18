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
  type Interaction,
  IntentsBitField,
} from 'discord.js';
import { readFileSync, existsSync } from 'fs';
import dotenv from 'dotenv';
import { SessionManager } from './sessions';
import { OpenCodeProcess, OneShotOpenCodeProcess, type OpenCodeEvent } from './opencode';
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

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
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
              flags: [MessageFlags.Ephemeral]
            });
          } else {
            await interaction.reply({
              content: 'Please provide a valid category.',
              flags: [MessageFlags.Ephemeral]
            });
          }
          break;
        }

        case 'new': {
          const prompt = options.getString('prompt') || 'Hello! How can you help me today?';
          const mode = options.getString('mode') || 'oneshot';
          await interaction.deferReply();

          try {
            let parentId = this.sessionManager.getCategoryId();
            if (!parentId && guild && typeof guild.channels.fetch === 'function') {
              const currentChannel = await guild.channels.fetch(channelId);
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
              const session = mode === 'oneshot' 
                ? this.sessionManager.prepareOneShotSession(channel.id)
                : this.sessionManager.prepareSession(channel.id);

              this.attachSessionListeners(session, channel as TextChannel);
              
              await interaction.editReply(`Created new ${mode} session in ${channel}`);
              
              // Mirror user prompt
              await (channel as TextChannel).send(`**User:** ${prompt}`);
              await (channel as TextChannel).send(`🚀 **Agent (${mode}) is starting up...**`);
              
              this.channelBusy.add(channel.id);
              session.start(prompt).finally(() => {
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
            if (!parentId && guild && typeof guild.channels.fetch === 'function') {
              const currentChannel = await guild.channels.fetch(channelId);
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
          if (session && session instanceof OpenCodeProcess) {
            session.interrupt();
            await interaction.reply('Interrupt signal sent!');
          } else {
            await interaction.reply({
              content: 'Interrupt not supported for this session type',
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
                flags: [MessageFlags.Ephemeral]
              });
            } catch (err: unknown) {
              const e = err as Error;
              await interaction.reply({
                content: `Failed to read logs: ${e.message}`,
                flags: [MessageFlags.Ephemeral]
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
            flags: [MessageFlags.Ephemeral]
          });
          break;
        }

        case 'debug': {
          const intents = this.client.options.intents;
          const msgContentIntent = (intents instanceof IntentsBitField) 
            ? intents.has(GatewayIntentBits.MessageContent)
            : false;
          const categoryId = this.sessionManager.getCategoryId();
          await interaction.reply({
            content: `**Debug Info:**\n- Message Content Intent: ${msgContentIntent ? '✅ Enabled' : '❌ Disabled'}\n- Active Sessions: ${this.sessionManager.getChannelMapping().size}\n- Category Set: ${categoryId ? '✅' : '❌'}`,
            flags: [MessageFlags.Ephemeral]
          });
          break;
        }
      }
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const session = this.sessionManager.getSession(message.channelId);
      const mode = this.sessionManager.getSessionType(message.channelId);

      if (session) {
        if (this.channelBusy.has(message.channelId)) {
          if (typeof message.reply === 'function') {
            await message.reply('⚠️ **Agent is currently busy. Please wait for the current task to finish.**');
          }
          return;
        }

        console.log(`[Discord] Message in session (${mode}) channel ${message.channelId}: ${message.content}`);
        try {
          if (mode === 'oneshot') {
            await message.react('📥');
            const stableSessionId = this.sessionManager.getChannelMapping().get(message.channelId);
            
            // Mirror prompt
            if (message.channel instanceof TextChannel) {
              await message.channel.send(`**User:** ${message.content}`);
            }

            const freshSession = new OneShotOpenCodeProcess(stableSessionId);
            this.attachSessionListeners(freshSession, message.channel as TextChannel);
            
            this.channelBusy.add(message.channelId);
            freshSession.start(message.content).finally(() => {
              this.channelBusy.delete(message.channelId);
            });
          } else {
            // For persistent/mock, we just send input
            session.sendInput(message.content);
            await message.react('📥');
          }
        } catch (error) {
          console.error('[Discord] Failed to handle message:', error);
          await message.react('❌');
        }
      }
    });
  }

  private attachSessionListeners(session: Agent, channel: TextChannel) {
    let firstOutput = true;

    session.on('output', (text: string) => {
      if (firstOutput) {
        console.log(`[Discord] First output received for channel ${channel.id}`);
        firstOutput = false;
      }
      console.log(`[Discord] Sending output to channel ${channel.id}`);
      channel.send(text).catch(console.error);
    });

    session.on('thinking', (isThinking: boolean) => {
      const existingInterval = this.typingIntervals.get(channel.id);
      const existingHeartbeat = this.heartbeatTimers.get(channel.id);

      if (isThinking) {
        if (!existingInterval) {
          channel.sendTyping().catch(console.error);
          const interval = setInterval(() => {
            channel.sendTyping().catch(console.error);
          }, 5000);
          this.typingIntervals.set(channel.id, interval);
        }

        if (!existingHeartbeat) {
          const heartbeat = setInterval(() => {
            channel.send('⏳ *Still thinking...*').catch(console.error);
          }, 30000);
          this.heartbeatTimers.set(channel.id, heartbeat);
        }
      } else {
        if (existingInterval) {
          clearInterval(existingInterval);
          this.typingIntervals.delete(channel.id);
        }
        if (existingHeartbeat) {
          clearInterval(existingHeartbeat);
          this.heartbeatTimers.delete(channel.id);
        }
      }
    });

    if (session instanceof OpenCodeProcess) {
      session.on('heartbeat', (seconds: number) => {
        if (seconds === 10) {
          channel.send('⚠️ **Agent is taking longer than expected to respond...**').catch(console.error);
        }
      });
    }

    session.on('idle', () => {
      channel.send('✅ **Ready for input**').catch(console.error);
    });

    session.on('error', (error: Error) => {
      console.error(`[Session Error] ${channel.id}:`, error);
      channel
        .send(`❌ **Error:** ${error.message || 'Unknown error occurred'}`)
        .catch(console.error);
    });

    session.on('stderr', (_data: string) => {
      // Stderr logging disabled to reduce noise
    });

    session.on('exit', async (code: number) => {
      if (code !== 0 && code !== null) {
        channel.send(`⚠️ **Process exited with code ${code}**`).catch(console.error);
        
        // Peek at stderr file
        await new Promise(r => setTimeout(r, 1000));
        if (typeof session.getStderrPath === 'function') {
          const stderrPath = session.getStderrPath();
          if (existsSync(stderrPath)) {
            const content = readFileSync(stderrPath, 'utf-8');
            if (content.trim()) {
              channel.send(`📋 **Final Stderr Peek:**\n\`\`\`\n${content.slice(-1000)}\n\`\`\``).catch(console.error);
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
        .setDescription('Start a new OpenCode session (One-Shot by default)')
        .addStringOption((option) =>
          option.setName('prompt').setDescription('Initial prompt for the agent'),
        )
        .addStringOption((option) =>
          option.setName('mode')
            .setDescription('Session mode (default: One-Shot)')
            .addChoices(
              { name: 'One-Shot (Stateless)', value: 'oneshot' },
              { name: 'Persistent (Stateful)', value: 'persistent' }
            )
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
            .setDescription('The ID of the session to resume')
            .setRequired(true),
        ),
      new SlashCommandBuilder()
        .setName('interrupt')
        .setDescription('Send an interrupt signal (double-ESC) to the current session'),
      new SlashCommandBuilder()
        .setName('peek-log')
        .setDescription('Peek at the raw stdout and stderr logs for this session'),
      new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Reset the busy lock for this channel if the agent is stuck'),
      new SlashCommandBuilder()
        .setName('debug')
        .setDescription('Show debug information about the bot status'),
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
          const type = this.sessionManager.getSessionType(channelId);
          
          if (type === 'oneshot') {
             // Just prepare metadata
             this.sessionManager.prepareOneShotSession(channelId, sessionId);
             continue;
          }

          console.log(`Recovering persistent session ${sessionId} in channel ${channelId}`);
          const session = type === 'mock'
             ? this.sessionManager.prepareMockSession(channelId, sessionId)
             : this.sessionManager.prepareSession(channelId, sessionId);

          this.attachSessionListeners(session, channel as TextChannel);
          
          await (channel as TextChannel).send(
            '🔄 **Bridge restarted. Re-attaching to session...**',
          );
          
          this.channelBusy.add(channel.id);
          session.start().finally(() => {
            this.channelBusy.delete(channel.id);
          });
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
