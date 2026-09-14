import { endpoint, type Registration } from './transport.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface IncomingTransaction {
  transactionID: string;
  requestID?: number;
  payload: { [key: string]: Json };
}
export interface PendingTransaction {
  sequence: number;
  transactionID: string;
  payload: IncomingTransaction['payload'];
}
export interface TransactionInbox {
  save(transaction: IncomingTransaction): Promise<'stored' | 'duplicate'>;
  pending(limit?: number): Promise<PendingTransaction[]>;
  complete(transactionID: string): Promise<void>;
}
const MAX_FRAME_LENGTH = 1024 * 1024;
const MAX_PENDING = 128;
const STORE = 'transactions';
interface StoredTransaction {
  sequence?: number;
  scope: string;
  transactionID: string;
  digest: string;
  pending: 0 | 1;
  payload?: IncomingTransaction['payload'];
}
export class InboxError extends Error {
  constructor(
    readonly reason: 'invalid' | 'storage' | 'full' | 'conflict' | 'missing',
  ) {
    super('Transaction inbox: ' + reason);
  }
}

// Transaction fields live at the top level in Beeper's appservice v3 protocol.
// Retain unknown fields, crypto updates, ephemeral events, and source timestamps.
export function parseTransaction(frame: unknown): IncomingTransaction | null {
  if (typeof frame !== 'string' || frame.length > MAX_FRAME_LENGTH)
    throw new InboxError('invalid');
  let value: Record<string, Json>;
  try {
    value = JSON.parse(frame);
  } catch {
    throw new InboxError('invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InboxError('invalid');
  if (
    value.command !== undefined &&
    value.command !== '' &&
    value.command !== 'transaction'
  )
    return null;
  const { id, command: _command, txn_id: transactionID, ...payload } = value;
  if (
    typeof transactionID !== 'string' ||
    !transactionID.length ||
    transactionID.length > 1024 ||
    (id !== undefined && (!Number.isSafeInteger(id) || Number(id) <= 0))
  )
    throw new InboxError('invalid');
  return {
    transactionID,
    ...(id !== undefined ? { requestID: id as number } : {}),
    payload,
  };
}

function canonical(value: Json, depth = 0): string {
  if (depth > 64 || (typeof value === 'number' && !Number.isFinite(value)))
    throw new InboxError('invalid');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return (
      '[' + value.map((item) => canonical(item, depth + 1)).join(',') + ']'
    );
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(
        (key) => JSON.stringify(key) + ':' + canonical(value[key]!, depth + 1),
      )
      .join(',') +
    '}'
  );
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new InboxError('storage'));
  });
}

export class IndexedDBInbox implements TransactionInbox {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly scope: string,
  ) {}

  static async open(
    registration: Registration,
    factory: IDBFactory = indexedDB,
    databaseName = 'beeper-muse-inbox',
  ): Promise<IndexedDBInbox> {
    // The token is never a key or record. Distinct homeservers/registrations
    // cannot read or deduplicate each other's transactions.
    const scope = JSON.stringify([
      endpoint(registration),
      registration.registrationID,
    ]);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open(databaseName, 1);
      let blocked = false;
      opening.onblocked = () => {
        blocked = true;
        reject(new InboxError('storage'));
      };
      opening.onerror = () => reject(new InboxError('storage'));
      opening.onupgradeneeded = () => {
        const store = opening.result.createObjectStore(STORE, {
          keyPath: 'sequence',
          autoIncrement: true,
        });
        store.createIndex('identity', ['scope', 'transactionID'], {
          unique: true,
        });
        store.createIndex('pending', ['scope', 'pending']);
      };
      opening.onsuccess = () => {
        if (blocked) opening.result.close();
        else resolve(opening.result);
      };
    });
    db.onversionchange = () => db.close();
    return new IndexedDBInbox(db, scope);
  }

  close(): void {
    this.db.close();
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    let tx: IDBTransaction;
    try {
      tx = this.db.transaction(STORE, mode, { durability: 'strict' });
    } catch {
      throw new InboxError('storage');
    }
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new InboxError('storage'));
      tx.onerror = () => reject(new InboxError('storage'));
    });
    // A failed request can reject both promises in the same event loop turn.
    void committed.catch(() => {});
    try {
      const result = await run(tx.objectStore(STORE));
      await committed;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The failed transaction may already have aborted.
      }
      await committed.catch(() => {});
      throw error instanceof InboxError ? error : new InboxError('storage');
    }
  }

  async save(incoming: IncomingTransaction): Promise<'stored' | 'duplicate'> {
    // Snapshot before any asynchronous work, so callers cannot change what gets
    // hashed or stored while a digest is in flight. Revalidate runtime inputs.
    const validated = parseTransaction(
      JSON.stringify({
        ...incoming.payload,
        txn_id: incoming.transactionID,
        command: 'transaction',
      }),
    )!;
    const bytes = new TextEncoder().encode(canonical(validated.payload));
    if (bytes.byteLength > MAX_FRAME_LENGTH) throw new InboxError('invalid');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const digest = Array.from(hash, (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    return this.transaction('readwrite', async (store) => {
      const key = [this.scope, validated.transactionID];
      const previous: StoredTransaction | undefined = await request(
        store.index('identity').get(key),
      );
      if (previous) {
        if (previous.digest !== digest) throw new InboxError('conflict');
        return 'duplicate';
      }
      const count = await request(
        store.index('pending').count([this.scope, 1]),
      );
      if (count >= MAX_PENDING) throw new InboxError('full');
      await request(
        store.add({
          scope: this.scope,
          transactionID: validated.transactionID,
          payload: validated.payload,
          digest,
          pending: 1,
        } satisfies StoredTransaction),
      );
      return 'stored';
    });
  }

  async pending(limit = 32): Promise<PendingTransaction[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PENDING)
      throw new InboxError('invalid');
    return this.transaction('readonly', async (store) => {
      const rows: StoredTransaction[] = await request(
        store.index('pending').getAll([this.scope, 1], limit),
      );
      return rows.map((row) => ({
        sequence: row.sequence!,
        transactionID: row.transactionID,
        payload: row.payload!,
      }));
    });
  }

  async complete(transactionID: string): Promise<void> {
    await this.transaction('readwrite', async (store) => {
      const row: StoredTransaction | undefined = await request(
        store.index('identity').get([this.scope, transactionID]),
      );
      if (!row) throw new InboxError('missing');
      if (!row.pending) return;
      // Keep a small receipt to prevent replay after completion, but drop the
      // event/key payload. Pruning receipts requires a server replay guarantee.
      delete row.payload;
      row.pending = 0;
      await request(store.put(row));
    });
  }
}

export interface TransactionAcknowledgement {
  id: number;
  command: 'response';
  data: { txn_id: string };
}
// Runtime integration must use this only once a durable crypto/event consumer
// is installed. Call serially to preserve arrival order. Completion is separate
// from receipt: consumers must make replayed side effects idempotent before
// marking work complete. The authentication probe deliberately does not call it.
export async function receiveTransaction(
  inbox: TransactionInbox,
  frame: unknown,
  acknowledge: (response: TransactionAcknowledgement) => void,
): Promise<'stored' | 'duplicate' | 'other'> {
  const transaction = parseTransaction(frame);
  if (!transaction) return 'other';
  const result = await inbox.save(transaction);
  if (transaction.requestID !== undefined)
    acknowledge({
      id: transaction.requestID,
      command: 'response',
      data: { txn_id: transaction.transactionID },
    });
  return result;
}
