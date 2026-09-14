// Development-only client for Beeper Desktop's documented v1 API.
// Never forward credentials to another origin or retry a mutation.
export class DevError extends Error {}
export interface Target {
  chatID: string;
  botID: string;
  ownerID: string;
}
export interface Message {
  id: string;
  chatID: string;
  senderID: string;
  timestamp: string;
  text?: string;
  isSender?: boolean;
  attachments?: { type: string }[];
  sendStatus?: { status: string; deliveredToUsers?: string[] };
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DevError('Invalid Desktop API response.');
  return value as Record<string, unknown>;
}
function verifyChat(chat: Record<string, unknown>, target: Target) {
  const members = object(chat.participants).items;
  if (
    chat.id !== target.chatID ||
    chat.isReadOnly ||
    !Array.isArray(members) ||
    members.length !== 2 ||
    !members.some((m) => object(m).id === target.botID) ||
    !members.some(
      (m) => object(m).id === target.ownerID && object(m).isSelf === true,
    )
  )
    throw new DevError(
      'Pinned chat does not match the expected owner and Muse bot.',
    );
}
export class Desktop {
  constructor(
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher('http://localhost:23373/v1' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + this.token,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DevError(
        'Desktop API unavailable or request outcome unknown. No automatic resend.',
      );
    }
    if (!response.ok)
      throw new DevError(
        `Desktop API returned HTTP ${response.status}. No automatic resend.`,
      );
    try {
      return object(await response.json());
    } catch {
      throw new DevError('Invalid Desktop API response. No automatic resend.');
    }
  }
  async verify(target: Target) {
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const data = await this.request(
        '/chats' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      );
      if (!Array.isArray(data.items)) throw new DevError('Invalid chat list.');
      const chat = data.items.map(object).find((c) => c.id === target.chatID);
      if (chat) {
        verifyChat(chat, target);
        return;
      }
      if (
        !data.hasMore ||
        typeof data.oldestCursor !== 'string' ||
        cursor === data.oldestCursor
      )
        break;
      cursor = data.oldestCursor;
    }
    throw new DevError('Pinned Muse chat was not found. No messages sent.');
  }
  async verifySendPath(target: Target) {
    // Listing/search can work while Desktop's per-chat platform calls fail.
    // This read detects that condition; it is not a delivery guarantee.
    try {
      const chat = await this.request(
        '/chats/' + encodeURIComponent(target.chatID),
      );
      verifyChat(chat, target);
    } catch {
      throw new DevError(
        'Desktop could not open the pinned Muse chat for sending. No test was sent. Chat listing alone does not establish readiness.',
      );
    }
  }
  async messages(target: Target, after: number): Promise<Message[]> {
    const query = new URLSearchParams({
      chatIDs: target.chatID,
      dateAfter: new Date(after).toISOString(),
      limit: '20',
      excludeLowPriority: 'false',
    });
    const data = await this.request('/messages/search?' + query);
    if (!Array.isArray(data.items) || data.hasMore)
      throw new DevError(
        'Message search is incomplete; narrow the test window.',
      );
    return data.items.map((value) => {
      const m = object(value);
      if (
        m.chatID !== target.chatID ||
        typeof m.id !== 'string' ||
        typeof m.senderID !== 'string' ||
        typeof m.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(m.timestamp))
      )
        throw new DevError(
          'Message search returned an invalid or different chat.',
        );
      const status = m.sendStatus ? object(m.sendStatus) : undefined;
      return {
        id: m.id,
        chatID: m.chatID,
        senderID: m.senderID,
        timestamp: m.timestamp,
        ...(typeof m.text === 'string' ? { text: m.text } : {}),
        ...(typeof m.isSender === 'boolean' ? { isSender: m.isSender } : {}),
        ...(Array.isArray(m.attachments)
          ? {
              attachments: m.attachments.map((a) => ({
                type: String(object(a).type),
              })),
            }
          : {}),
        ...(status && typeof status.status === 'string'
          ? {
              sendStatus: {
                status: status.status,
                deliveredToUsers: Array.isArray(status.deliveredToUsers)
                  ? status.deliveredToUsers.filter(
                      (v): v is string => typeof v === 'string',
                    )
                  : [],
              },
            }
          : {}),
      };
    });
  }
  async upload(content: string): Promise<string> {
    const data = await this.request('/assets/upload/base64', {
      content,
      fileName: 'beeper-muse-test.png',
      mimeType: 'image/png',
    });
    if (typeof data.uploadID !== 'string' || !data.uploadID || data.error)
      throw new DevError('Desktop did not confirm the test image upload.');
    return data.uploadID;
  }
  async send(target: Target, text: string, uploadID?: string) {
    const data = await this.request(
      '/chats/' + encodeURIComponent(target.chatID) + '/messages',
      {
        text,
        ...(uploadID
          ? { attachment: { uploadID, type: 'image', mimeType: 'image/png' } }
          : {}),
      },
    );
    if (
      typeof data.pendingMessageID !== 'string' ||
      !data.pendingMessageID ||
      data.chatID !== target.chatID
    )
      throw new DevError(
        'Desktop did not confirm the send request. Observe this run; do not resend.',
      );
    return data.pendingMessageID;
  }
}
