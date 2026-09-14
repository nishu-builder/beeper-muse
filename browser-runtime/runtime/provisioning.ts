import { connectedBridgeState, MUSE_LOGIN_ID } from './bridge-metadata.js';
import type { MatrixAPI } from './matrix.js';

// Read-only subset of mautrix bridgev2 provisioning, carried over the existing
// authenticated WebSocket. This is not an HTTP listener or a general URL proxy.
export async function provisioningResponse(
  frame: Record<string, unknown>,
  api: MatrixAPI,
): Promise<string> {
  const respond = (status: number, body: unknown) =>
    JSON.stringify({
      id: frame.id,
      command: 'response',
      data: {
        status,
        headers: { 'Content-Type': ['application/json'] },
        body,
      },
    });
  const error = (status: number, errcode: string) =>
    respond(status, { errcode, error: 'Provisioning request rejected.' });
  const req = frame.data as Record<string, unknown> | undefined;
  if (!Number.isSafeInteger(frame.id) || !req || typeof req !== 'object')
    return error(400, 'M_BAD_JSON');
  if (req.method !== 'GET') return error(405, 'M_UNRECOGNIZED');
  let path = req.path;
  try {
    if (req.escaped_path === true && typeof path === 'string')
      path = decodeURIComponent(path);
  } catch {
    return error(400, 'M_INVALID_PARAM');
  }
  // Public bridge capabilities contain no account or conversation information.
  if (path === '/_matrix/provision/v3/capabilities')
    return respond(200, {
      resolve_identifier: {
        create_dm: false,
        lookup_phone: false,
        lookup_email: false,
        lookup_username: false,
        any_phone: false,
        contact_list: false,
        search: false,
      },
      group_creation: {},
    });
  if (path === '/_matrix/provision/v3/login/flows')
    return respond(200, { flows: [] });
  if (
    path !== '/_matrix/provision/v3/whoami' &&
    path !== '/_matrix/provision/v3/logins'
  )
    return error(404, 'M_UNRECOGNIZED');

  const query = new URLSearchParams(
    typeof req.query === 'string' ? req.query : '',
  );
  if (
    query.getAll('user_id').length !== 1 ||
    query.get('user_id') !== api.config.owner
  )
    return error(403, 'M_FORBIDDEN');
  const headers = req.headers;
  if (!headers || typeof headers !== 'object')
    return error(401, 'M_MISSING_TOKEN');
  const auth = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === 'authorization',
  );
  const values = auth[0]?.[1];
  if (
    auth.length !== 1 ||
    !Array.isArray(values) ||
    values.length !== 1 ||
    typeof values[0] !== 'string' ||
    !/^Bearer [^\s]+$/.test(values[0])
  )
    return error(401, 'M_MISSING_TOKEN');
  try {
    const identity = await api.request<{ user_id: string }>(
      'GET',
      '/_matrix/client/v3/account/whoami',
      undefined,
      api.config.owner,
      values[0].slice(7),
    );
    if (identity.user_id !== api.config.owner) return error(403, 'M_FORBIDDEN');
  } catch {
    return error(401, 'M_UNKNOWN_TOKEN');
  }
  if (path.endsWith('/logins'))
    return respond(200, { login_ids: [MUSE_LOGIN_ID] });
  const state = connectedBridgeState(api.config.owner);
  return respond(200, {
    network: {
      displayname: 'Muse',
      network_url: 'https://muse.ai',
      network_id: 'muse',
      beeper_bridge_type: 'github.com/nishu-builder/beeper-muse',
    },
    login_flows: [],
    homeserver: 'beeper.local',
    bridge_bot: api.config.bot,
    command_prefix: '!muse',
    logins: [
      {
        id: MUSE_LOGIN_ID,
        name: 'Muse browser',
        profile: {},
        state_event: state.state_event,
        state_ts: state.timestamp,
        state,
      },
    ],
  });
}
