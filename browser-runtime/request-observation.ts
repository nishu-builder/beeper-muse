// Return only bounded diagnostic metadata. Never expose request URLs, header
// values, raw network errors, or response bodies in the development UI.
export interface RequestObservation {
  url: string;
  initiator?: string;
  tabId: number;
  requestHeaders?: Array<{ name: string; value?: string }>;
  statusCode?: number;
  error?: string;
}
export interface RequestScope {
  url: string;
  origin: string;
  tabId: number;
  headers: Array<{ header: string; value: string }>;
}
export function describeRequest(
  scope: RequestScope,
  request: RequestObservation,
): string[] {
  if (
    request.url !== scope.url ||
    request.initiator !== scope.origin ||
    request.tabId !== scope.tabId
  )
    return [];
  const lines: string[] = [];
  if (request.requestHeaders) {
    lines.push(
      request.requestHeaders.some((h) => h.name.toLowerCase() === 'origin')
        ? 'Origin: still present'
        : 'Origin: absent (native handshake)',
    );
    for (const name of [
      'Authorization',
      'X-Mautrix-Process-ID',
      'X-Mautrix-Websocket-Version',
    ]) {
      const expected = scope.headers.find((h) => h.header === name)?.value;
      const actual = request.requestHeaders.filter(
        (h) => h.name.toLowerCase() === name.toLowerCase(),
      );
      lines.push(
        name +
          ': ' +
          (actual.length === 1 &&
          expected !== undefined &&
          actual[0]!.value === expected
            ? 'verified'
            : 'missing or changed'),
      );
    }
  }
  if (
    Number.isInteger(request.statusCode) &&
    request.statusCode! >= 100 &&
    request.statusCode! <= 599
  )
    lines.push('Handshake HTTP status: ' + request.statusCode);
  if (request.error)
    lines.push(
      /^net::ERR_[A-Z0-9_]+$/.test(request.error)
        ? request.error
        : 'Network request failed',
    );
  return lines;
}
