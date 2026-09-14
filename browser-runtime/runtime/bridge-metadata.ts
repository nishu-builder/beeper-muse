import type { Configuration } from './matrix.js';
export const MUSE_LOGIN_ID = 'browser';
export function museBridgeInfo(config: Configuration) {
  return {
    bridgebot: config.bot,
    creator: config.bot,
    protocol: {
      id: 'muse',
      displayname: 'Muse',
      external_url: 'https://muse.ai',
    },
    channel: {
      id: 'muse',
      displayname: 'Muse',
      'fi.mau.receiver': MUSE_LOGIN_ID,
    },
    'com.beeper.room_type': 'dm',
    'com.beeper.room_type.v2': 'dm',
  };
}
export interface BridgeState {
  state_event: 'CONNECTED';
  timestamp: number;
  ttl: number;
  source: 'bridge';
  user_id: string;
  remote_id: typeof MUSE_LOGIN_ID;
  remote_name: string;
}
// Same bridge_status payload as mautrix bridgev2. Timestamps are Unix seconds.
export function connectedBridgeState(
  owner: string,
  now = Date.now(),
): BridgeState {
  return {
    state_event: 'CONNECTED',
    timestamp: Math.floor(now / 1000),
    ttl: 21600,
    source: 'bridge',
    user_id: owner,
    remote_id: MUSE_LOGIN_ID,
    remote_name: 'Muse browser',
  };
}
