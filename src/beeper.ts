import BeeperDesktop from '@beeper/desktop-api';
import { loopbackURL } from './config.ts';

export interface Message {
  id: string;
  chatID: string;
  timestamp: string;
  text?: string;
  isSender?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
}
export interface Page {
  items: Message[];
  hasMore: boolean;
  newestCursor: string | null;
  oldestCursor: string | null;
}
export interface BeeperPort {
  list(
    chatID: string,
    cursor?: string,
    direction?: 'before' | 'after',
  ): Promise<Page>;
  send(chatID: string, text: string, replyTo: string): Promise<void>;
}

export function beeperClient(
  baseURL: string,
  accessToken: string,
): BeeperDesktop {
  const origin = loopbackURL(baseURL);
  return new BeeperDesktop({
    baseURL: origin,
    accessToken,
    timeout: 15000,
    maxRetries: 0,
    logLevel: 'off',
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== origin)
        throw new Error('Beeper request left the configured origin.');
      return fetch(input, { ...init, redirect: 'error' });
    },
  });
}

export class BeeperAdapter implements BeeperPort {
  constructor(private readonly client: BeeperDesktop) {}
  async list(
    chatID: string,
    cursor?: string,
    direction?: 'before' | 'after',
  ): Promise<Page> {
    return await this.client.messages.list(
      chatID,
      cursor ? { cursor, direction } : {},
    );
  }
  async send(chatID: string, text: string, replyTo: string): Promise<void> {
    await this.client.messages.send(chatID, {
      text,
      replyToMessageID: replyTo,
    });
  }
}

export async function validateSelfChat(
  client: BeeperDesktop,
  chatID: string,
): Promise<void> {
  const chat = await client.chats.retrieve(chatID, { maxParticipantCount: -1 });
  if (
    chat.type !== 'single' ||
    chat.isReadOnly ||
    chat.participants.hasMore ||
    chat.participants.items.length !== 1 ||
    chat.participants.items[0]?.isSelf !== true
  ) {
    throw new Error(
      'Only a writable Note to self chat with no other participants is supported.',
    );
  }
}
