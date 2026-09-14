/** Only authenticated connection-page observations can bypass the update guard. */
export function isConnectionDiagnostic(
  type: unknown,
  sender: { id?: string; url?: string; frameId?: number },
  extensionID: string,
  connectionURL: string,
) {
  return (
    (type === 'diagnostic-health' || type === 'diagnostic-progress') &&
    sender.id === extensionID &&
    sender.url === connectionURL &&
    sender.frameId === 0
  );
}
export class RuntimeWork {
  active = 0;
  async run<T>(task: () => Promise<T>, observation = false): Promise<T> {
    if (!observation) this.active++;
    try {
      return await task();
    } finally {
      if (!observation) this.active--;
    }
  }
}
