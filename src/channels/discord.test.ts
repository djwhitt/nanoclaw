import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

// Mock config
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- discord.js mock ---

type Handler = (...args: any[]) => any;

const clientRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('discord.js', () => {
  const Events = {
    MessageCreate: 'messageCreate',
    ClientReady: 'ready',
    Error: 'error',
    InteractionCreate: 'interactionCreate',
  };

  const GatewayIntentBits = {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    DirectMessages: 8,
  };

  const ButtonStyle = {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
  };

  class MockClient {
    eventHandlers = new Map<string, Handler[]>();
    user: any = { id: '999888777', tag: 'Andy#1234' };
    private _ready = false;

    constructor(_opts: any) {
      clientRef.current = this;
    }

    on(event: string, handler: Handler) {
      const existing = this.eventHandlers.get(event) || [];
      existing.push(handler);
      this.eventHandlers.set(event, existing);
      return this;
    }

    once(event: string, handler: Handler) {
      return this.on(event, handler);
    }

    async login(_token: string) {
      this._ready = true;
      // Fire the ready event
      const readyHandlers = this.eventHandlers.get('ready') || [];
      for (const h of readyHandlers) {
        h({ user: this.user });
      }
    }

    isReady() {
      return this._ready;
    }

    channels = {
      fetch: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ id: 'sent_msg_001' }),
        sendTyping: vi.fn().mockResolvedValue(undefined),
        messages: {
          fetch: vi.fn().mockResolvedValue({
            edit: vi.fn().mockResolvedValue(undefined),
          }),
        },
      }),
    };

    destroy() {
      this._ready = false;
    }
  }

  // Mock TextChannel type
  class TextChannel {}

  // Mock AttachmentBuilder
  class AttachmentBuilder {
    filePath: string;
    constructor(filePath: string) {
      this.filePath = filePath;
    }
  }

  // Mock component builders
  class ActionRowBuilder {
    _components: any[] = [];
    addComponents(...components: any[]) {
      this._components.push(...components);
      return this;
    }
  }

  class ButtonBuilder {
    _data: any = {};
    setCustomId(id: string) { this._data.customId = id; return this; }
    setLabel(label: string) { this._data.label = label; return this; }
    setStyle(style: number) { this._data.style = style; return this; }
    setDisabled(disabled: boolean) { this._data.disabled = disabled; return this; }
  }

  class StringSelectMenuBuilder {
    _data: any = {};
    _options: any[] = [];
    setCustomId(id: string) { this._data.customId = id; return this; }
    setPlaceholder(ph: string) { this._data.placeholder = ph; return this; }
    setMinValues(n: number) { this._data.minValues = n; return this; }
    setMaxValues(n: number) { this._data.maxValues = n; return this; }
    setDisabled(disabled: boolean) { this._data.disabled = disabled; return this; }
    addOptions(...opts: any[]) { this._options.push(...opts); return this; }
  }

  class StringSelectMenuOptionBuilder {
    _data: any = {};
    setLabel(label: string) { this._data.label = label; return this; }
    setValue(value: string) { this._data.value = value; return this; }
    setDescription(desc: string) { this._data.description = desc; return this; }
  }

  return {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client: MockClient,
    Events,
    GatewayIntentBits,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextChannel,
  };
});

import { DiscordChannel, DiscordChannelOpts } from './discord.js';

// --- Test helpers ---

function createTestOpts(
  overrides?: Partial<DiscordChannelOpts>,
): DiscordChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'dc:1234567890123456': {
        name: 'Test Server #general',
        folder: 'test-server',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
    ...overrides,
  };
}

function createMessage(overrides: {
  channelId?: string;
  content?: string;
  authorId?: string;
  authorUsername?: string;
  authorDisplayName?: string;
  memberDisplayName?: string;
  isBot?: boolean;
  guildName?: string;
  channelName?: string;
  messageId?: string;
  createdAt?: Date;
  attachments?: Map<string, any>;
  reference?: { messageId?: string };
  mentionsBotId?: boolean;
}) {
  const channelId = overrides.channelId ?? '1234567890123456';
  const authorId = overrides.authorId ?? '55512345';
  const botId = '999888777'; // matches mock client user id

  const mentionsMap = new Map();
  if (overrides.mentionsBotId) {
    mentionsMap.set(botId, { id: botId });
  }

  return {
    channelId,
    id: overrides.messageId ?? 'msg_001',
    content: overrides.content ?? 'Hello everyone',
    createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
    author: {
      id: authorId,
      username: overrides.authorUsername ?? 'alice',
      displayName: overrides.authorDisplayName ?? 'Alice',
      bot: overrides.isBot ?? false,
    },
    member: overrides.memberDisplayName
      ? { displayName: overrides.memberDisplayName }
      : null,
    guild: overrides.guildName
      ? { name: overrides.guildName }
      : null,
    channel: {
      name: overrides.channelName ?? 'general',
      messages: {
        fetch: vi.fn().mockResolvedValue({
          author: { username: 'Bob', displayName: 'Bob' },
          member: { displayName: 'Bob' },
        }),
      },
    },
    mentions: {
      users: mentionsMap,
    },
    attachments: overrides.attachments ?? new Map(),
    reference: overrides.reference ?? null,
  };
}

function currentClient() {
  return clientRef.current;
}

async function triggerMessage(message: any) {
  const handlers = currentClient().eventHandlers.get('messageCreate') || [];
  for (const h of handlers) await h(message);
}

async function triggerInteraction(interaction: any) {
  const handlers = currentClient().eventHandlers.get('interactionCreate') || [];
  for (const h of handlers) await h(interaction);
}

function createButtonInteraction(overrides: {
  channelId?: string;
  customId?: string;
  label?: string;
  userId?: string;
  userName?: string;
  messageId?: string;
}) {
  return {
    channelId: overrides.channelId ?? '1234567890123456',
    customId: overrides.customId ?? 'approve',
    id: 'interaction_001',
    user: {
      id: overrides.userId ?? '55512345',
      username: overrides.userName ?? 'alice',
      displayName: overrides.userName ?? 'Alice',
    },
    member: overrides.userName ? { displayName: overrides.userName } : null,
    message: { id: overrides.messageId ?? 'comp_msg_001' },
    component: { label: overrides.label ?? 'Approve' },
    values: undefined,
    isButton: () => true,
    isStringSelectMenu: () => false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

function createSelectInteraction(overrides: {
  channelId?: string;
  customId?: string;
  values?: string[];
  userId?: string;
  userName?: string;
  messageId?: string;
}) {
  return {
    channelId: overrides.channelId ?? '1234567890123456',
    customId: overrides.customId ?? 'priority',
    id: 'interaction_002',
    user: {
      id: overrides.userId ?? '55512345',
      username: overrides.userName ?? 'alice',
      displayName: overrides.userName ?? 'Alice',
    },
    member: overrides.userName ? { displayName: overrides.userName } : null,
    message: { id: overrides.messageId ?? 'comp_msg_001' },
    component: {},
    values: overrides.values ?? ['high'],
    isButton: () => false,
    isStringSelectMenu: () => true,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

// --- Tests ---

describe('DiscordChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Connection lifecycle ---

  describe('connection lifecycle', () => {
    it('resolves connect() when client is ready', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.connect();

      expect(channel.isConnected()).toBe(true);
    });

    it('registers message handlers on connect', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.connect();

      expect(currentClient().eventHandlers.has('messageCreate')).toBe(true);
      expect(currentClient().eventHandlers.has('error')).toBe(true);
      expect(currentClient().eventHandlers.has('ready')).toBe(true);
    });

    it('disconnects cleanly', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.connect();
      expect(channel.isConnected()).toBe(true);

      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });

    it('isConnected() returns false before connect', () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      expect(channel.isConnected()).toBe(false);
    });
  });

  // --- Text message handling ---

  describe('text message handling', () => {
    it('delivers message for registered channel', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'Hello everyone',
        guildName: 'Test Server',
        channelName: 'general',
      });
      await triggerMessage(msg);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.any(String),
        'Test Server #general',
      );
      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          id: 'msg_001',
          chat_jid: 'dc:1234567890123456',
          sender: '55512345',
          sender_name: 'Alice',
          content: 'Hello everyone',
          is_from_me: false,
        }),
      );
    });

    it('only emits metadata for unregistered channels', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        channelId: '9999999999999999',
        content: 'Unknown channel',
        guildName: 'Other Server',
      });
      await triggerMessage(msg);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'dc:9999999999999999',
        expect.any(String),
        expect.any(String),
      );
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('ignores bot messages', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ isBot: true, content: 'I am a bot' });
      await triggerMessage(msg);

      expect(opts.onMessage).not.toHaveBeenCalled();
      expect(opts.onChatMetadata).not.toHaveBeenCalled();
    });

    it('uses member displayName when available (server nickname)', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'Hi',
        memberDisplayName: 'Alice Nickname',
        authorDisplayName: 'Alice Global',
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({ sender_name: 'Alice Nickname' }),
      );
    });

    it('falls back to author displayName when no member', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'Hi',
        memberDisplayName: undefined,
        authorDisplayName: 'Alice Global',
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({ sender_name: 'Alice Global' }),
      );
    });

    it('uses sender name for DM chats (no guild)', async () => {
      const opts = createTestOpts({
        registeredGroups: vi.fn(() => ({
          'dc:1234567890123456': {
            name: 'DM',
            folder: 'dm',
            trigger: '@Andy',
            added_at: '2024-01-01T00:00:00.000Z',
          },
        })),
      });
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'Hello',
        guildName: undefined,
        authorDisplayName: 'Alice',
      });
      await triggerMessage(msg);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.any(String),
        'Alice',
      );
    });

    it('uses guild name + channel name for server messages', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'Hello',
        guildName: 'My Server',
        channelName: 'bot-chat',
      });
      await triggerMessage(msg);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.any(String),
        'My Server #bot-chat',
      );
    });
  });

  // --- @mention translation ---

  describe('@mention translation', () => {
    it('translates <@botId> mention to trigger format', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: '<@999888777> what time is it?',
        mentionsBotId: true,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '@Andy what time is it?',
        }),
      );
    });

    it('does not translate if message already matches trigger', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: '@Andy hello <@999888777>',
        mentionsBotId: true,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      // Should NOT prepend @Andy — already starts with trigger
      // But the <@botId> should still be stripped
      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '@Andy hello',
        }),
      );
    });

    it('does not translate when bot is not mentioned', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'hello everyone',
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: 'hello everyone',
        }),
      );
    });

    it('handles <@!botId> (nickname mention format)', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: '<@!999888777> check this',
        mentionsBotId: true,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '@Andy check this',
        }),
      );
    });
  });

  // --- Attachments ---

  describe('attachments', () => {
    it('stores image attachment with placeholder', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const attachments = new Map([
        ['att1', { name: 'photo.png', contentType: 'image/png' }],
      ]);
      const msg = createMessage({
        content: '',
        attachments,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '[Image: photo.png]',
        }),
      );
    });

    it('stores video attachment with placeholder', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const attachments = new Map([
        ['att1', { name: 'clip.mp4', contentType: 'video/mp4' }],
      ]);
      const msg = createMessage({
        content: '',
        attachments,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '[Video: clip.mp4]',
        }),
      );
    });

    it('stores file attachment with placeholder', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const attachments = new Map([
        ['att1', { name: 'report.pdf', contentType: 'application/pdf' }],
      ]);
      const msg = createMessage({
        content: '',
        attachments,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '[File: report.pdf]',
        }),
      );
    });

    it('includes text content with attachments', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const attachments = new Map([
        ['att1', { name: 'photo.jpg', contentType: 'image/jpeg' }],
      ]);
      const msg = createMessage({
        content: 'Check this out',
        attachments,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: 'Check this out\n[Image: photo.jpg]',
        }),
      );
    });

    it('handles multiple attachments', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const attachments = new Map([
        ['att1', { name: 'a.png', contentType: 'image/png' }],
        ['att2', { name: 'b.txt', contentType: 'text/plain' }],
      ]);
      const msg = createMessage({
        content: '',
        attachments,
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '[Image: a.png]\n[File: b.txt]',
        }),
      );
    });
  });

  // --- Reply context ---

  describe('reply context', () => {
    it('includes reply author in content', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'I agree with that',
        reference: { messageId: 'original_msg_id' },
        guildName: 'Server',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '[Reply to Bob] I agree with that',
        }),
      );
    });
  });

  // --- sendMessage ---

  describe('sendMessage', () => {
    it('sends message via channel', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.sendMessage('dc:1234567890123456', 'Hello');

      const fetchedChannel = await currentClient().channels.fetch('1234567890123456');
      expect(currentClient().channels.fetch).toHaveBeenCalledWith('1234567890123456');
    });

    it('strips dc: prefix from JID', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.sendMessage('dc:9876543210', 'Test');

      expect(currentClient().channels.fetch).toHaveBeenCalledWith('9876543210');
    });

    it('handles send failure gracefully', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      currentClient().channels.fetch.mockRejectedValueOnce(
        new Error('Channel not found'),
      );

      // Should not throw
      await expect(
        channel.sendMessage('dc:1234567890123456', 'Will fail'),
      ).resolves.toBeUndefined();
    });

    it('does nothing when client is not initialized', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      // Don't connect — client is null
      await channel.sendMessage('dc:1234567890123456', 'No client');

      // No error, no API call
    });

    it('splits messages exceeding 2000 characters', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const mockChannel = {
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping: vi.fn(),
      };
      currentClient().channels.fetch.mockResolvedValue(mockChannel);

      const longText = 'x'.repeat(3000);
      await channel.sendMessage('dc:1234567890123456', longText);

      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenNthCalledWith(1, 'x'.repeat(2000));
      expect(mockChannel.send).toHaveBeenNthCalledWith(2, 'x'.repeat(1000));
    });
  });

  // --- sendFile ---

  describe('sendFile', () => {
    it('sends file as attachment without caption', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const mockChannel = {
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping: vi.fn(),
      };
      currentClient().channels.fetch.mockResolvedValue(mockChannel);

      await channel.sendFile('dc:1234567890123456', '/tmp/diagram.png');

      expect(currentClient().channels.fetch).toHaveBeenCalledWith('1234567890123456');
      expect(mockChannel.send).toHaveBeenCalledWith({
        content: undefined,
        files: [expect.objectContaining({ filePath: '/tmp/diagram.png' })],
      });
    });

    it('sends file as attachment with caption', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const mockChannel = {
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping: vi.fn(),
      };
      currentClient().channels.fetch.mockResolvedValue(mockChannel);

      await channel.sendFile('dc:1234567890123456', '/tmp/diagram.png', 'Here is your diagram');

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: 'Here is your diagram',
        files: [expect.objectContaining({ filePath: '/tmp/diagram.png' })],
      });
    });

    it('does nothing when client is not initialized', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      // Don't connect — client is null
      await channel.sendFile('dc:1234567890123456', '/tmp/diagram.png');

      // No error, no API call
    });

    it('handles send failure gracefully', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      currentClient().channels.fetch.mockRejectedValueOnce(
        new Error('Channel not found'),
      );

      await expect(
        channel.sendFile('dc:1234567890123456', '/tmp/diagram.png'),
      ).resolves.toBeUndefined();
    });
  });

  // --- ownsJid ---

  describe('ownsJid', () => {
    it('owns dc: JIDs', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('dc:1234567890123456')).toBe(true);
    });

    it('does not own WhatsApp group JIDs', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('12345@g.us')).toBe(false);
    });

    it('does not own Telegram JIDs', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('tg:123456789')).toBe(false);
    });

    it('does not own unknown JID formats', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('random-string')).toBe(false);
    });
  });

  // --- setTyping ---

  describe('setTyping', () => {
    it('sends typing indicator when isTyping is true', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const mockChannel = {
        send: vi.fn(),
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      currentClient().channels.fetch.mockResolvedValue(mockChannel);

      await channel.setTyping('dc:1234567890123456', true);

      expect(mockChannel.sendTyping).toHaveBeenCalled();
    });

    it('does nothing when isTyping is false', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.setTyping('dc:1234567890123456', false);

      // channels.fetch should NOT be called
      expect(currentClient().channels.fetch).not.toHaveBeenCalled();
    });

    it('does nothing when client is not initialized', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      // Don't connect
      await channel.setTyping('dc:1234567890123456', true);

      // No error
    });
  });

  // --- sendComponents ---

  describe('sendComponents', () => {
    it('sends message with component builders and returns message ID', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const mockChannel = {
        send: vi.fn().mockResolvedValue({ id: 'sent_comp_001' }),
        sendTyping: vi.fn(),
        messages: { fetch: vi.fn() },
      };
      currentClient().channels.fetch.mockResolvedValue(mockChannel);

      const messageId = await channel.sendComponents('dc:1234567890123456', 'Choose:', [
        {
          type: 'action_row',
          components: [
            { type: 'button', custom_id: 'approve', label: 'Approve', style: 'success' },
            { type: 'button', custom_id: 'reject', label: 'Reject', style: 'danger' },
          ],
        },
      ]);

      expect(messageId).toBe('sent_comp_001');
      expect(mockChannel.send).toHaveBeenCalledWith({
        content: 'Choose:',
        components: expect.any(Array),
      });
      // Verify action rows were built
      const callArgs = mockChannel.send.mock.calls[0][0];
      expect(callArgs.components).toHaveLength(1);
    });
  });

  // --- updateComponents ---

  describe('updateComponents', () => {
    it('fetches message and calls edit with correct payload', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const mockEdit = vi.fn().mockResolvedValue(undefined);
      const mockChannel = {
        send: vi.fn(),
        sendTyping: vi.fn(),
        messages: {
          fetch: vi.fn().mockResolvedValue({ edit: mockEdit }),
        },
      };
      currentClient().channels.fetch.mockResolvedValue(mockChannel);

      await channel.updateComponents('dc:1234567890123456', 'msg_to_update', 'Approved!', []);

      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg_to_update');
      expect(mockEdit).toHaveBeenCalledWith({
        content: 'Approved!',
        components: [],
      });
    });

    it('omits content when text is undefined', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const mockEdit = vi.fn().mockResolvedValue(undefined);
      const mockChannel = {
        send: vi.fn(),
        sendTyping: vi.fn(),
        messages: {
          fetch: vi.fn().mockResolvedValue({ edit: mockEdit }),
        },
      };
      currentClient().channels.fetch.mockResolvedValue(mockChannel);

      await channel.updateComponents('dc:1234567890123456', 'msg_to_update', undefined, []);

      expect(mockEdit).toHaveBeenCalledWith({
        components: [],
      });
    });
  });

  // --- InteractionCreate ---

  describe('InteractionCreate', () => {
    it('calls deferUpdate and delivers synthetic message for button click', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const interaction = createButtonInteraction({
        customId: 'approve',
        label: 'Approve',
        userName: 'Alice',
        messageId: 'comp_msg_001',
      });
      await triggerInteraction(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '@Andy [Button: approve "Approve" by Alice on message comp_msg_001]',
          sender: '55512345',
          sender_name: 'Alice',
          is_from_me: false,
        }),
      );
    });

    it('includes select values in synthetic message', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const interaction = createSelectInteraction({
        customId: 'priority',
        values: ['high', 'urgent'],
        userName: 'Alice',
        messageId: 'comp_msg_002',
      });
      await triggerInteraction(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:1234567890123456',
        expect.objectContaining({
          content: '@Andy [Select: priority values=["high","urgent"] by Alice on message comp_msg_002]',
        }),
      );
    });

    it('ignores interactions from unregistered channels', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const interaction = createButtonInteraction({
        channelId: '9999999999999999',
        customId: 'approve',
      });
      await triggerInteraction(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('registers InteractionCreate handler on connect', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      expect(currentClient().eventHandlers.has('interactionCreate')).toBe(true);
    });
  });

  // --- Channel properties ---

  describe('channel properties', () => {
    it('has name "discord"', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.name).toBe('discord');
    });
  });
});
