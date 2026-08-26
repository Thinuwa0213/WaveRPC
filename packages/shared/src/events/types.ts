import { Track } from '../types/track.js';
import { PlaybackState } from '../types/provider.js';
import { DiscordPresenceData } from '../types/presence.js';
import { WaveRPCSettings } from '../types/settings.js';

export interface WaveRPCEvents {
  'track:changed': (track: Track | undefined) => void;
  'playback:stateChanged': (state: PlaybackState) => void;
  'provider:activated': (providerId: string) => void;
  'provider:deactivated': (providerId: string) => void;
  'presence:updated': (presence: DiscordPresenceData | undefined) => void;
  'discord:connected': () => void;
  'discord:disconnected': () => void;
  'extension:connected': () => void;
  'extension:disconnected': () => void;
  'status:changed': (status: any) => void;
  'settings:changed': (settings: WaveRPCSettings) => void;
}

export type EventName = keyof WaveRPCEvents;
