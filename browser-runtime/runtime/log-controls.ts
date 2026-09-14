import { LogCollector } from './log-collector.js';
declare const __BEEPER_MUSE_BUILD_ID__: string;
import { StateStore } from './state.js';
import { LogFileWriter, type LogHandle } from './log-file.js';
interface SavedHandle extends LogHandle {
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface PickerWindow {
  showSaveFilePicker(options: unknown): Promise<SavedHandle>;
}
// The user selects one normal file. Never inspect profiles or choose a path
// programmatically. Only the sanitized diagnostic ring is written to that file.
export function startLogControls(version?: string, build?: string) {
  const choose = document.getElementById(
    'choose-log',
  ) as HTMLButtonElement | null;
  const stop = document.getElementById('stop-log') as HTMLButtonElement | null;
  const status = document.getElementById('log-status');
  if (!choose || !stop || !status) return;
  const picker = window as unknown as PickerWindow;
  let store: StateStore | undefined;
  let handle: SavedHandle | undefined;
  let writer: LogFileWriter | undefined;
  let busy = false,
    disposed = false;
  const ready = StateStore.open('diagnostic-file')
    .then(async (s) => {
      store = s;
      handle = await s.get<SavedHandle>('handle');
      if (handle) writer = new LogFileWriter(handle);
    })
    .catch(() => {
      status.textContent = 'Chrome could not open the saved log settings.';
    });
  const collector = new LogCollector(
    version ?? chrome.runtime.getManifest().version,
    build ?? __BEEPER_MUSE_BUILD_ID__,
    async () =>
      (await chrome.storage.local.get('diagnosticEvents')).diagnosticEvents,
    () => chrome.runtime.sendMessage({ type: 'diagnostic-health' }),
    () => chrome.runtime.sendMessage({ type: 'diagnostic-progress' }),
  );
  async function flush() {
    if (busy || disposed) return;
    busy = true;
    try {
      await ready;
      if (!writer) return;
      const sample = await collector.collect();
      await writer.write(sample.events, sample.health, sample.collection);
      status!.textContent =
        sample.collection.health === 'available' &&
        sample.collection.events === 'available'
          ? 'Diagnostic file is updating. You can return to Muse.'
          : 'Diagnostic file is updating, but runtime diagnostics are incomplete. The file records what is unavailable.';
    } catch {
      status!.textContent =
        'Log file needs attention. Choose Allow file updates or select the file again.';
    } finally {
      busy = false;
    }
  }
  choose.onclick = () => {
    // Invoke the picker before awaiting anything: Chrome requires user activation.
    if (typeof picker.showSaveFilePicker !== 'function') {
      status.textContent =
        'This Chrome context does not support choosing a log file.';
      return;
    }
    const selected = picker.showSaveFilePicker({
      id: 'beeper-muse-diagnostic-log',
      startIn: 'downloads',
      suggestedName: 'beeper-muse-diagnostics.json',
      types: [
        {
          description: 'JSON diagnostic log',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
    void (async () => {
      try {
        const next = await selected;
        await ready;
        if (!store) throw Error('Storage unavailable.');
        await writer?.idle();
        await store.put('handle', next);
        handle = next;
        writer = new LogFileWriter(next);
        await flush();
      } catch {
        status.textContent =
          'No new log file was enabled. Choose a file to try again.';
      }
    })();
  };
  const allow = document.getElementById('allow-log');
  if (allow)
    allow.onclick = () => {
      if (!handle) {
        status.textContent = 'Choose a diagnostic log file first.';
        return;
      }
      void handle
        .requestPermission({ mode: 'readwrite' })
        .then(() => flush())
        .catch(() => {
          status.textContent =
            'Chrome did not allow updates to the diagnostic file.';
        });
    };
  stop.onclick = () => {
    void (async () => {
      await ready;
      const previous = writer;
      writer = undefined;
      handle = undefined;
      await previous?.idle();
      await store?.put('handle', null);
      status.textContent =
        'File logging stopped. The existing file was left in place.';
    })().catch(() => {
      status.textContent =
        'Could not save the log setting. Close this connection tab to stop file updates.';
    });
  };
  // Socket heartbeat also flushes: background tabs can throttle ordinary timers.
  const timer = setInterval(() => void flush(), 5000);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      clearInterval(timer);
      store?.close();
    },
    { once: true },
  );
  void ready.then(flush);
  return flush;
}
