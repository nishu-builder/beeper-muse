export class StateStore {
  private constructor(
    private db: IDBDatabase,
    private scope: string,
  ) {}
  static async open(scope: string, factory: IDBFactory = indexedDB) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('beeper-muse-runtime', 1);
      let blocked = false;
      req.onupgradeneeded = () => req.result.createObjectStore('state');
      req.onsuccess = () => {
        if (blocked) req.result.close();
        else resolve(req.result);
      };
      req.onerror = () => reject(Error('Browser storage unavailable.'));
      req.onblocked = () => {
        blocked = true;
        reject(Error('Close other Beeper Muse setup tabs.'));
      };
    });
    db.onversionchange = () => db.close();
    return new StateStore(db, scope);
  }
  async get<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const req = this.db
        .transaction('state')
        .objectStore('state')
        .get([this.scope, key]);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(Error('Browser storage unavailable.'));
    });
  }
  async put(key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('state', 'readwrite', {
        durability: 'strict',
      });
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(Error('Browser storage write failed.'));
      tx.objectStore('state').put(value, [this.scope, key]);
    });
  }
  async keys(prefix: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const req = this.db
        .transaction('state')
        .objectStore('state')
        .getAllKeys();
      req.onsuccess = () =>
        resolve(
          req.result
            .filter(
              (k) =>
                Array.isArray(k) &&
                k[0] === this.scope &&
                typeof k[1] === 'string' &&
                k[1].startsWith(prefix),
            )
            .map((k) => (k as string[])[1]!),
        );
      req.onerror = () => reject(Error('Browser storage unavailable.'));
    });
  }
  close() {
    this.db.close();
  }
}
