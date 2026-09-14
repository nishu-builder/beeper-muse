export const sourceFiles = [
  'adapter.js',
  'sync.js',
  'activity.js',
  'content.js',
];
export function isMuseURL(url?: string) {
  try {
    const u = new URL(url!);
    return u.origin === 'https://muse.ai' && u.pathname === '/';
  } catch {
    return false;
  }
}
export interface MuseTabAPI {
  get(id: number): Promise<{ id?: number; url?: string; discarded?: boolean }>;
  send(
    id: number,
    message: { type: string },
  ): Promise<{ protocol?: number; health?: string }>;
  inject(id: number, files: string[]): Promise<unknown>;
}
/** Installs only our packaged code in the previously selected, still-valid tab. */
export async function ensureMuseTab(api: MuseTabAPI, id: number) {
  const tab = await api.get(id);
  if (!isMuseURL(tab.url) || tab.discarded)
    throw Error('Muse tab unavailable.');
  let probe = await api.send(id, { type: 'probe' }).catch(() => null);
  if (probe?.protocol !== 17) {
    await api.inject(id, sourceFiles);
    probe = await api.send(id, { type: 'probe' });
  }
  if (
    probe?.protocol !== 17 ||
    !['ready', 'draft', 'busy'].includes(probe.health || '')
  )
    throw Error('Open and sign in to the main Muse chat.');
  return probe;
}

export function resumeTicket(
  value: unknown,
  now = Date.now(),
): { tabID: number; documentID: string; expires: number } | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (
    typeof v.tabID === 'number' &&
    Number.isInteger(v.tabID) &&
    v.tabID > 0 &&
    typeof v.documentID === 'string' &&
    // Chromium serializes its document token as 32 hex characters, not a
    // hyphenated UUID. Preserve the exact token when targeting the document.
    /^[a-f0-9]{32}$/i.test(v.documentID) &&
    !/^0{32}$/.test(v.documentID) &&
    typeof v.expires === 'number' &&
    Number.isFinite(v.expires) &&
    v.expires >= now &&
    v.expires <= now + 120000
  )
    return { tabID: v.tabID, documentID: v.documentID, expires: v.expires };
}
