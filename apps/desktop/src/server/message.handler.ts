import { TypedEventEmitter, Track, PrivacySanitizer, Logger } from '@waverpc/shared';
import { ExtensionMessage, TrackUpdateMessage, PlaybackUpdateMessage } from './types.js';

const log = new Logger('MessageHandler');

export class ExtensionMessageHandler {
  constructor(private events: TypedEventEmitter) {}

  public handleMessage(rawMessage: string): boolean {
    try {
      const parsed: ExtensionMessage = JSON.parse(rawMessage);
      if (!parsed || typeof parsed.type !== 'string') {
        log.warn('Received invalid message structure.');
        return false;
      }

      log.debug('Incoming message type:', parsed.type);

      switch (parsed.type) {
        case 'TRACK_UPDATE':
          this.handleTrackUpdate(parsed as TrackUpdateMessage);
          return true;

        case 'PLAYBACK_UPDATE':
          this.handlePlaybackUpdate(parsed as PlaybackUpdateMessage);
          return true;

        case 'TRACK_CLEAR':
          this.handleTrackClear();
          return true;

        case 'PING':
          return true;

        default:
          log.warn(`Unknown message type: ${(parsed as { type: string }).type}`);
          return false;
      }
    } catch (error) {
      log.error('Failed to parse JSON message:', error);
      return false;
    }
  }

  private handleTrackUpdate(message: TrackUpdateMessage): void {
    const { title, artist, url, artwork, duration, isPlaying, providerId } = message.payload;
    if (!title || !artist || !url) {
      log.warn('Incomplete track payload received.');
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

    log.info(
      `Processed & sanitized TRACK_UPDATE: "${sanitizedTrack.title}" by ${sanitizedTrack.artist}`
    );
    this.events.emit('track:changed', sanitizedTrack);
  }

  private handlePlaybackUpdate(message: PlaybackUpdateMessage): void {
    const { playbackState } = message.payload;
    log.info(`Processed PLAYBACK_UPDATE: ${playbackState}`);
    this.events.emit('playback:stateChanged', playbackState);
  }

  private handleTrackClear(): void {
    log.info('Processed TRACK_CLEAR: clearing active track metadata.');
    this.events.emit('track:changed', undefined);
  }
}
