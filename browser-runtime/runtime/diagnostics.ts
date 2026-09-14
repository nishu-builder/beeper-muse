import { MatrixError } from './matrix.js';

// Never display raw exceptions: network/SDK errors can include account URLs,
// tokens or message contents. Only known categories and fixed text are exposed.
export function startupFailure(error: unknown): string {
  if (error instanceof MatrixError) return error.message;
  if (error instanceof Error) {
    const storage: Record<string, string> = {
      'Browser storage unavailable.': 'Chrome could not open its saved data.',
      'Browser storage write failed.': 'Chrome could not save its data.',
      'Close other Beeper Muse setup tabs.':
        'Close other Beeper Muse setup tabs, then reconnect.',
    };
    if (Object.hasOwn(storage, error.message)) return storage[error.message]!;
    const categories: Record<string, string> = {
      TypeError: 'A browser operation failed (TypeError).',
      SecurityError: 'Chrome denied access (SecurityError).',
      QuotaExceededError: 'Chrome storage is full (QuotaExceededError).',
      VersionError: 'Saved data uses a newer version (VersionError).',
      AbortError: 'The operation was interrupted (AbortError).',
      TimeoutError: 'The connection timed out (TimeoutError).',
      InvalidStateError: 'Browser storage is not ready (InvalidStateError).',
      UnknownError: 'Chrome reported a storage error (UnknownError).',
    };
    if (Object.hasOwn(categories, error.name)) return categories[error.name]!;
  }
  return 'An unexpected startup error occurred.';
}
