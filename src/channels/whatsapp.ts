import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  WASocket,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import type { WAMessage, WAMessageContent } from '@whiskeysockets/baileys';

import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  MAX_ATTACHMENT_DOWNLOAD_SIZE,
  STORE_DIR,
} from '../config.js';
import { getLastGroupSync, setLastGroupSync, updateChatName } from '../db.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import { logger } from '../logger.js';
import { registerChannel } from './registry.js';
import {
  Channel,
  MessageAttachment,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface MediaInfo {
  type: 'image' | 'video' | 'audio' | 'document';
  mimetype: string;
  fileLength: number;
  filename?: string;
  isImage: boolean;
}

function getMediaInfo(message: WAMessageContent): MediaInfo | null {
  if (message.imageMessage) {
    return {
      type: 'image',
      mimetype: message.imageMessage.mimetype || 'image/jpeg',
      fileLength: Number(message.imageMessage.fileLength || 0),
      isImage: true,
    };
  }
  if (message.videoMessage) {
    return {
      type: 'video',
      mimetype: message.videoMessage.mimetype || 'video/mp4',
      fileLength: Number(message.videoMessage.fileLength || 0),
      isImage: false,
    };
  }
  if (message.audioMessage) {
    return {
      type: 'audio',
      mimetype: message.audioMessage.mimetype || 'audio/ogg',
      fileLength: Number(message.audioMessage.fileLength || 0),
      isImage: false,
    };
  }
  if (message.documentMessage) {
    return {
      type: 'document',
      mimetype: message.documentMessage.mimetype || 'application/octet-stream',
      fileLength: Number(message.documentMessage.fileLength || 0),
      filename: message.documentMessage.fileName || undefined,
      isImage: false,
    };
  }
  return null;
}

function deriveFilename(media: MediaInfo): string {
  if (media.filename) return media.filename;
  const ext = media.mimetype.split(';')[0]?.split('/')[1] || 'bin';
  return `${media.type}.${ext}`;
}

function guessMimetype(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.zip': 'application/zip',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

export interface WhatsAppChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class WhatsAppChannel implements Channel {
  name = 'whatsapp';

  private sock!: WASocket;
  private connected = false;
  private lidToPhoneMap: Record<string, string> = {};
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private groupSyncTimerStarted = false;

  private opts: WhatsAppChannelOpts;

  constructor(opts: WhatsAppChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectInternal(resolve).catch(reject);
    });
  }

  private async connectInternal(onFirstOpen?: () => void): Promise<void> {
    const authDir = path.join(STORE_DIR, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
      logger.warn(
        { err },
        'Failed to fetch latest WA Web version, using default',
      );
      return { version: undefined };
    });
    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'),
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const msg =
          'WhatsApp authentication required. Run /setup in Claude Code.';
        logger.error(msg);
        exec(
          `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
        );
        setTimeout(() => process.exit(1), 1000);
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        logger.info(
          {
            reason,
            shouldReconnect,
            queuedMessages: this.outgoingQueue.length,
          },
          'Connection closed',
        );

        if (shouldReconnect) {
          logger.info('Reconnecting...');
          this.connectInternal().catch((err) => {
            logger.error({ err }, 'Failed to reconnect, retrying in 5s');
            setTimeout(() => {
              this.connectInternal().catch((err2) => {
                logger.error({ err: err2 }, 'Reconnection retry failed');
              });
            }, 5000);
          });
        } else {
          logger.info('Logged out. Run /setup to re-authenticate.');
          process.exit(0);
        }
      } else if (connection === 'open') {
        this.connected = true;
        logger.info('Connected to WhatsApp');

        // Announce availability so WhatsApp relays subsequent presence updates (typing indicators)
        this.sock.sendPresenceUpdate('available').catch((err) => {
          logger.warn({ err }, 'Failed to send presence update');
        });

        // Build LID to phone mapping from auth state for self-chat translation
        if (this.sock.user) {
          const phoneUser = this.sock.user.id.split(':')[0];
          const lidUser = this.sock.user.lid?.split(':')[0];
          if (lidUser && phoneUser) {
            this.lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
            logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
          }
        }

        // Flush any messages queued while disconnected
        this.flushOutgoingQueue().catch((err) =>
          logger.error({ err }, 'Failed to flush outgoing queue'),
        );

        // Sync group metadata on startup (respects 24h cache)
        this.syncGroupMetadata().catch((err) =>
          logger.error({ err }, 'Initial group sync failed'),
        );
        // Set up daily sync timer (only once)
        if (!this.groupSyncTimerStarted) {
          this.groupSyncTimerStarted = true;
          setInterval(() => {
            this.syncGroupMetadata().catch((err) =>
              logger.error({ err }, 'Periodic group sync failed'),
            );
          }, GROUP_SYNC_INTERVAL_MS);
        }

        // Signal first connection to caller
        if (onFirstOpen) {
          onFirstOpen();
          onFirstOpen = undefined;
        }
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;

        // Translate LID JID to phone JID if applicable
        const chatJid = await this.translateJid(rawJid);

        const timestamp = new Date(
          Number(msg.messageTimestamp) * 1000,
        ).toISOString();

        // Always notify about chat metadata for group discovery
        const isGroup = chatJid.endsWith('@g.us');
        this.opts.onChatMetadata(
          chatJid,
          timestamp,
          undefined,
          'whatsapp',
          isGroup,
        );

        // Only deliver full message for registered groups
        const groups = this.opts.registeredGroups();
        if (groups[chatJid]) {
          const content =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

          const mediaInfo = msg.message ? getMediaInfo(msg.message) : null;

          // Skip protocol messages with no text and no media
          if (!content && !mediaInfo) continue;

          const sender = msg.key.participant || msg.key.remoteJid || '';
          const senderName = msg.pushName || sender.split('@')[0];

          const fromMe = msg.key.fromMe || false;
          const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
            ? fromMe
            : content.startsWith(`${ASSISTANT_NAME}:`);

          // Download media attachments
          let finalContent = content;
          let attachments: MessageAttachment[] | undefined;

          if (mediaInfo) {
            const { downloaded, description } = await this.downloadMedia(
              msg,
              mediaInfo,
              groups[chatJid].folder,
            );
            if (downloaded) {
              attachments = [downloaded];
            }
            if (description) {
              finalContent = finalContent
                ? `${finalContent}\n${description}`
                : description;
            }
          }

          this.opts.onMessage(chatJid, {
            id: msg.key.id || '',
            chat_jid: chatJid,
            sender,
            sender_name: senderName,
            content: finalContent,
            timestamp,
            is_from_me: fromMe,
            is_bot_message: isBotMessage,
            attachments,
          });
        }
      }
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Prefix bot messages with assistant name so users know who's speaking.
    // On a shared number, prefix is also needed in DMs (including self-chat)
    // to distinguish bot output from user messages.
    // Skip only when the assistant has its own dedicated phone number.
    const prefixed = ASSISTANT_HAS_OWN_NUMBER
      ? text
      : `${ASSISTANT_NAME}: ${text}`;

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.info(
        { jid, length: prefixed.length, queueSize: this.outgoingQueue.length },
        'WA disconnected, message queued',
      );
      return;
    }
    try {
      await this.sock.sendMessage(jid, { text: prefixed });
      logger.info({ jid, length: prefixed.length }, 'Message sent');
    } catch (err) {
      // If send fails, queue it for retry on reconnect
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.warn(
        { jid, err, queueSize: this.outgoingQueue.length },
        'Failed to send, message queued',
      );
    }
  }

  async sendFile(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    if (!this.connected) {
      logger.warn({ jid, filePath }, 'Cannot send file: not connected');
      return;
    }
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.3gp'];
      const audioExts = ['.mp3', '.ogg', '.m4a', '.wav', '.opus'];

      let messageContent: Parameters<WASocket['sendMessage']>[1];

      if (imageExts.includes(ext)) {
        messageContent = { image: buffer, caption: caption || undefined };
      } else if (videoExts.includes(ext)) {
        messageContent = { video: buffer, caption: caption || undefined };
      } else if (audioExts.includes(ext)) {
        messageContent = { audio: buffer, ptt: false };
      } else {
        messageContent = {
          document: buffer,
          mimetype: guessMimetype(ext),
          fileName: path.basename(filePath),
          caption: caption || undefined,
        };
      }

      await this.sock.sendMessage(jid, messageContent);
      logger.info({ jid, filePath }, 'WhatsApp file sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send WhatsApp file');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.sock?.end(undefined);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    try {
      const status = isTyping ? 'composing' : 'paused';
      logger.debug({ jid, status }, 'Sending presence update');
      await this.sock.sendPresenceUpdate(status, jid);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update typing status');
    }
  }

  /**
   * Sync group metadata from WhatsApp.
   * Fetches all participating groups and stores their names in the database.
   * Called on startup, daily, and on-demand via IPC.
   */
  async syncGroupMetadata(force = false): Promise<void> {
    if (!force) {
      const lastSync = getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        if (Date.now() - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
          logger.debug({ lastSync }, 'Skipping group sync - synced recently');
          return;
        }
      }
    }

    try {
      logger.info('Syncing group metadata from WhatsApp...');
      const groups = await this.sock.groupFetchAllParticipating();

      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          updateChatName(jid, metadata.subject);
          count++;
        }
      }

      setLastGroupSync();
      logger.info({ count }, 'Group metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync group metadata');
    }
  }

  private async downloadMedia(
    msg: WAMessage,
    media: MediaInfo,
    groupFolder: string,
  ): Promise<{ downloaded?: MessageAttachment; description: string }> {
    const name = deriveFilename(media);

    if (media.fileLength > MAX_ATTACHMENT_DOWNLOAD_SIZE) {
      const sizeMB = Math.round(media.fileLength / 1024 / 1024);
      const maxMB = Math.round(MAX_ATTACHMENT_DOWNLOAD_SIZE / 1024 / 1024);
      return {
        description: `[File too large: ${name} (${sizeMB}MB, max ${maxMB}MB)]`,
      };
    }

    const groupDir = resolveGroupFolderPath(groupFolder);
    const inboxDir = path.join(groupDir, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });

    const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destFilename = `${Date.now()}-${sanitized}`;
    const destPath = path.join(inboxDir, destFilename);
    const relativePath = `inbox/${destFilename}`;

    try {
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: this.sock.updateMediaMessage,
        },
      )) as Buffer;

      fs.writeFileSync(destPath, buffer);

      logger.debug(
        { filename: name, size: buffer.length, relativePath },
        'WhatsApp attachment downloaded',
      );

      const tag = media.isImage
        ? 'Image'
        : media.type.charAt(0).toUpperCase() + media.type.slice(1);
      return {
        downloaded: {
          filename: name,
          path: relativePath,
          mimeType: media.mimetype,
          size: buffer.length,
          isImage: media.isImage,
        },
        description: `[${tag}: ${name} → ${relativePath}]`,
      };
    } catch (err) {
      logger.warn(
        { filename: name, err },
        'Failed to download WhatsApp attachment',
      );
      const tag = media.isImage
        ? 'Image'
        : media.type.charAt(0).toUpperCase() + media.type.slice(1);
      return { description: `[${tag}: ${name}]` };
    }
  }

  private async translateJid(jid: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    // Check local cache first
    const cached = this.lidToPhoneMap[lidUser];
    if (cached) {
      logger.debug(
        { lidJid: jid, phoneJid: cached },
        'Translated LID to phone JID (cached)',
      );
      return cached;
    }

    // Query Baileys' signal repository for the mapping
    try {
      const pn = await this.sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) {
        const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        this.lidToPhoneMap[lidUser] = phoneJid;
        logger.info(
          { lidJid: jid, phoneJid },
          'Translated LID to phone JID (signalRepository)',
        );
        return phoneJid;
      }
    } catch (err) {
      logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
    }

    return jid;
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing outgoing message queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        // Send directly — queued items are already prefixed by sendMessage
        await this.sock.sendMessage(item.jid, { text: item.text });
        logger.info(
          { jid: item.jid, length: item.text.length },
          'Queued message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}

registerChannel('whatsapp', (opts) => {
  const authDir = path.join(STORE_DIR, 'auth');
  if (!fs.existsSync(authDir) || fs.readdirSync(authDir).length === 0)
    return null;
  return new WhatsAppChannel(opts);
});
