import { TypedEventEmitter, Track, PrivacySanitizer } from '@waverpc/shared';
import { ExtensionMessage, TrackUpdateMessage, PlaybackUpdateMessage } from './types.js';

export class ExtensionMessageHandler {
  constructor(private events: TypedEventEmitter) {}

  public handleMessage(rawMessage: string): boolean {
    try {
      const parsed: ExtensionMessage = JSON.parse(rawMessage);
      if (!parsed || typeof parsed.type !== 'string') {
        console.warn('[ExtensionMessageHandler] Received invalid message structure.');
        return false;
      }

      switch (parsed.type) {
        case 'TRACK_UPDATE':
          this.handleTrackUpdate(parsed as TrackUpdateMessage);
          return true;

        case 'PLAYBACK_UPDATE':
          this.handlePlaybackUpdate(parsed as PlaybackUpdateMessage);
          return true;

        case 'PING':
          return true;

        default:
          console.warn(
            `[ExtensionMessageHandler] Unknown message type: ${(parsed as { type: string }).type}`
          );
          return false;
      }
    } catch (error) {
      console.error('[ExtensionMessageHandler] Failed to parse JSON message:', error);
      return false;
    }
  }

  private handleTrackUpdate(message: TrackUpdateMessage): void {
    const { title, artist, url, artwork, duration, isPlaying, providerId } = message.payload;
    if (!title || !artist || !url) {
      console.warn('[ExtensionMessageHandler] Incomplete track payload received.');
      return;
    }

    if (providerId) {
      this.events.emit('provider:activated', providerId);
    }

    const rawTrack: Track = {
      title,
      artist,
      url,
      artwork,
      duration,
      isPlaying,
    };

    const sanitizedTrack = PrivacySanitizer.sanitizeTrack(rawTrack);

    console.log(
      `[ExtensionMessageHandler] Processed & sanitized TRACK_UPDATE: "${sanitizedTrack.title}" by ${sanitizedTrack.artist}`
    );
    this.events.emit('track:changed', sanitizedTrack);
  }

  private handlePlaybackUpdate(message: PlaybackUpdateMessage): void {
    const { playbackState } = message.payload;
    console.log(`[ExtensionMessageHandler] Processed PLAYBACK_UPDATE: ${playbackState}`);
    this.events.emit('playback:stateChanged', playbackState);
  }
}
