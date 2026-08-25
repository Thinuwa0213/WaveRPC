import { Track } from '../types/track.js';
import { PlaybackState } from '../types/provider.js';
import { DiscordPresenceData } from '../types/presence.js';

export interface WaveRPCEvents {
  'track:changed': (track: Track | undefined) => void;
  'playback:stateChanged': (state: PlaybackState) => void;
  'provider:activated': (providerId: string) => void;
  'provider:deactivated': (providerId: string) => void;
  'presence:updated': (presence: DiscordPresenceData | undefined) => void;
}

export type EventName = keyof WaveRPCEvents;
