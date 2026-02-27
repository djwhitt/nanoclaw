import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from 'discord.js';

import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, MAX_ATTACHMENT_DOWNLOAD_SIZE, TRIGGER_PATTERN } from '../config.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import { logger } from '../logger.js';
import {
  Channel,
  IpcActionRow,
  IpcButton,
  IpcStringSelect,
  MessageAttachment,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: DiscordChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bot messages (including own)
      if (message.author.bot) return;

      const channelId = message.channelId;
      const chatJid = `dc:${channelId}`;
      let content = message.content;
      const timestamp = message.createdAt.toISOString();
      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      // Determine chat name
      let chatName: string;
      if (message.guild) {
        const textChannel = message.channel as TextChannel;
        chatName = `${message.guild.name} #${textChannel.name}`;
      } else {
        chatName = senderName;
      }

      // Translate Discord @bot mentions into TRIGGER_PATTERN format.
      // Discord mentions look like <@botUserId> — these won't match
      // TRIGGER_PATTERN (e.g., ^@Andy\b), so we prepend the trigger
      // when the bot is @mentioned.
      if (this.client?.user) {
        const botId = this.client.user.id;
        const isBotMentioned =
          message.mentions.users.has(botId) ||
          content.includes(`<@${botId}>`) ||
          content.includes(`<@!${botId}>`);

        if (isBotMentioned) {
          // Strip the <@botId> mention to avoid visual clutter
          content = content
            .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
            .trim();
          // Prepend trigger if not already present
          if (!TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Handle reply context — include who the user is replying to
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const replyAuthor =
            repliedTo.member?.displayName ||
            repliedTo.author.displayName ||
            repliedTo.author.username;
          content = `[Reply to ${replyAuthor}] ${content}`;
        } catch {
          // Referenced message may have been deleted
        }
      }

      // Store chat metadata for discovery
      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Discord channel',
        );
        return;
      }

      // Handle attachments — download to group inbox for registered groups
      let attachments: MessageAttachment[] | undefined;
      if (message.attachments.size > 0) {
        const groupDir = resolveGroupFolderPath(group.folder);
        const inboxDir = path.join(groupDir, 'inbox');
        fs.mkdirSync(inboxDir, { recursive: true });

        const descriptions: string[] = [];
        const downloaded: MessageAttachment[] = [];

        for (const att of message.attachments.values()) {
          const contentType = att.contentType || 'application/octet-stream';
          const name = att.name || 'file';
          const size = att.size || 0;
          const isImage = contentType.startsWith('image/');

          if (size > MAX_ATTACHMENT_DOWNLOAD_SIZE) {
            descriptions.push(`[File too large: ${name} (${Math.round(size / 1024 / 1024)}MB, max ${Math.round(MAX_ATTACHMENT_DOWNLOAD_SIZE / 1024 / 1024)}MB)]`);
            continue;
          }

          const sanitizedName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const ts = Date.now();
          const destFilename = `${ts}-${sanitizedName}`;
          const destPath = path.join(inboxDir, destFilename);
          const relativePath = `inbox/${destFilename}`;

          try {
            const response = await fetch(att.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(destPath, buffer);

            downloaded.push({
              filename: name,
              path: relativePath,
              mimeType: contentType,
              size: buffer.length,
              isImage,
            });

            if (isImage) {
              descriptions.push(`[Image: ${name} → ${relativePath}]`);
            } else {
              descriptions.push(`[File: ${name} → ${relativePath}]`);
            }

            logger.debug(
              { chatJid, filename: name, size: buffer.length, relativePath },
              'Discord attachment downloaded',
            );
          } catch (err) {
            logger.warn(
              { chatJid, filename: name, err },
              'Failed to download Discord attachment',
            );
            // Fall back to placeholder
            if (isImage) {
              descriptions.push(`[Image: ${name}]`);
            } else if (contentType.startsWith('video/')) {
              descriptions.push(`[Video: ${name}]`);
            } else if (contentType.startsWith('audio/')) {
              descriptions.push(`[Audio: ${name}]`);
            } else {
              descriptions.push(`[File: ${name}]`);
            }
          }
        }

        if (descriptions.length > 0) {
          content = content
            ? `${content}\n${descriptions.join('\n')}`
            : descriptions.join('\n');
        }
        if (downloaded.length > 0) {
          attachments = downloaded;
        }
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
        attachments,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Discord message stored',
      );
    });

    // Handle button clicks and select menu interactions
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

      // Acknowledge immediately (meet Discord's 3-second deadline, no visual change)
      await interaction.deferUpdate();

      const channelId = interaction.channelId;
      const chatJid = `dc:${channelId}`;
      const userName =
        interaction.member && 'displayName' in interaction.member
          ? (interaction.member.displayName as string)
          : interaction.user.displayName || interaction.user.username;
      const messageId = interaction.message.id;

      // Build synthetic message content
      let syntheticContent: string;
      if (interaction.isButton()) {
        syntheticContent = `@${ASSISTANT_NAME} [Button: ${interaction.customId} "${(interaction.component as any).label ?? interaction.customId}" by ${userName} on message ${messageId}]`;
      } else {
        const values = JSON.stringify(interaction.values);
        syntheticContent = `@${ASSISTANT_NAME} [Select: ${interaction.customId} values=${values} by ${userName} on message ${messageId}]`;
      }

      // Only deliver for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid },
          'Interaction from unregistered Discord channel, ignoring',
        );
        return;
      }

      this.opts.onMessage(chatJid, {
        id: interaction.id,
        chat_jid: chatJid,
        sender: interaction.user.id,
        sender_name: userName,
        content: syntheticContent,
        timestamp: new Date().toISOString(),
        is_from_me: false,
      });

      logger.info(
        { chatJid, customId: interaction.isButton() ? interaction.customId : interaction.customId, userName },
        'Discord interaction delivered',
      );
    });

    // Handle errors gracefully
    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );
        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(
          `  Use /chatid command or check channel IDs in Discord settings\n`,
        );
        resolve();
      });

      this.client!.login(this.botToken);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;

      // Discord has a 2000 character limit per message — split if needed
      const MAX_LENGTH = 2000;
      if (text.length <= MAX_LENGTH) {
        await textChannel.send(text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await textChannel.send(text.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async sendFile(jid: string, filePath: string, caption?: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;
      await textChannel.send({
        content: caption || undefined,
        files: [new AttachmentBuilder(filePath)],
      });
      logger.info({ jid, filePath }, 'Discord file sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Discord file');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }

  async sendComponents(jid: string, text: string, components: IpcActionRow[]): Promise<string> {
    if (!this.client) throw new Error('Discord client not initialized');

    const channelId = jid.replace(/^dc:/, '');
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      throw new Error(`Discord channel not found or not text-based: ${jid}`);
    }

    const textChannel = channel as TextChannel;
    const rows = components.map((row) => buildActionRow(row));
    const sent = await textChannel.send({ content: text, components: rows });
    logger.info({ jid, messageId: sent.id }, 'Discord components sent');
    return sent.id;
  }

  async updateComponents(jid: string, messageId: string, text?: string, components?: IpcActionRow[]): Promise<void> {
    if (!this.client) throw new Error('Discord client not initialized');

    const channelId = jid.replace(/^dc:/, '');
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      throw new Error(`Discord channel not found or not text-based: ${jid}`);
    }

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(messageId);

    const editPayload: { content?: string; components?: ActionRowBuilder<any>[] } = {};
    if (text !== undefined) editPayload.content = text;
    if (components !== undefined) editPayload.components = components.map((row) => buildActionRow(row));

    await message.edit(editPayload);
    logger.info({ jid, messageId }, 'Discord components updated');
  }
}

const STYLE_MAP: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function buildActionRow(row: IpcActionRow): ActionRowBuilder<any> {
  const actionRow = new ActionRowBuilder();
  for (const comp of row.components) {
    if (comp.type === 'button') {
      const btn = comp as IpcButton;
      const builder = new ButtonBuilder()
        .setCustomId(btn.custom_id)
        .setLabel(btn.label)
        .setStyle(STYLE_MAP[btn.style || 'primary'] || ButtonStyle.Primary);
      if (btn.disabled) builder.setDisabled(true);
      actionRow.addComponents(builder);
    } else if (comp.type === 'string_select') {
      const sel = comp as IpcStringSelect;
      const builder = new StringSelectMenuBuilder()
        .setCustomId(sel.custom_id);
      if (sel.placeholder) builder.setPlaceholder(sel.placeholder);
      if (sel.min_values !== undefined) builder.setMinValues(sel.min_values);
      if (sel.max_values !== undefined) builder.setMaxValues(sel.max_values);
      if (sel.disabled) builder.setDisabled(true);
      builder.addOptions(
        sel.options.map((opt) => {
          const optBuilder = new StringSelectMenuOptionBuilder()
            .setLabel(opt.label)
            .setValue(opt.value);
          if (opt.description) optBuilder.setDescription(opt.description);
          return optBuilder;
        }),
      );
      actionRow.addComponents(builder);
    }
  }
  return actionRow as ActionRowBuilder<any>;
}
