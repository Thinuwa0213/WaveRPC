import { PlaybackState } from '@waverpc/shared';

export type ExtensionMessageType = 'TRACK_UPDATE' | 'PLAYBACK_UPDATE' | 'PING';

export interface ExtensionTrackPayload {
  title: string;
  artist: string;
  url: string;
  artwork?: string;
  duration?: number;
  isPlaying: boolean;
  providerId?: string;
}

export interface ExtensionTrackUpdateMessage {
  type: 'TRACK_UPDATE';
  payload: ExtensionTrackPayload;
}

export interface ExtensionPlaybackPayload {
  isPlaying: boolean;
  playbackState?: PlaybackState;
}

export interface ExtensionPlaybackUpdateMessage {
  type: 'PLAYBACK_UPDATE';
  payload: ExtensionPlaybackPayload;
}

export interface ExtensionPingMessage {
  type: 'PING';
}

export type ExtensionOutboundMessage =
  ExtensionTrackUpdateMessage | ExtensionPlaybackUpdateMessage | ExtensionPingMessage;
