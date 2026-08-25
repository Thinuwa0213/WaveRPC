import { PlaybackState } from '@waverpc/shared';

export type MessageType = 'TRACK_UPDATE' | 'PLAYBACK_UPDATE' | 'PING' | 'PONG';

export interface TrackUpdatePayload {
  title: string;
  artist: string;
  url: string;
  artwork?: string;
  duration?: number;
  isPlaying: boolean;
  providerId?: string;
}

export interface TrackUpdateMessage {
  type: 'TRACK_UPDATE';
  payload: TrackUpdatePayload;
}

export interface PlaybackUpdatePayload {
  isPlaying: boolean;
  playbackState: PlaybackState;
}

export interface PlaybackUpdateMessage {
  type: 'PLAYBACK_UPDATE';
  payload: PlaybackUpdatePayload;
}

export interface PingMessage {
  type: 'PING';
}

export interface PongMessage {
  type: 'PONG';
}

export type ExtensionMessage =
  TrackUpdateMessage | PlaybackUpdateMessage | PingMessage | PongMessage;

export interface ServerOptions {
  port?: number;
  host?: string;
}
