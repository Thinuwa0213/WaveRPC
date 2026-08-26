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

      if (parsed.type !== 'PING') {
        log.debug('Incoming message type:', parsed.type);
      }

      switch (parsed.type) {
        case 'TRACK_UPDATE':
          const tuMessage = parsed as TrackUpdateMessage;
          if (!ExtensionMessageHandler.validateTrackPayload(tuMessage.payload)) {
            log.warn('Invalid TRACK_UPDATE payload received.');
            return false;
          }
          this.handleTrackUpdate(tuMessage);
          return true;

        case 'PLAYBACK_UPDATE':
          const pbMessage = parsed as PlaybackUpdateMessage;
          if (
            !pbMessage.payload ||
            typeof pbMessage.payload !== 'object' ||
            typeof pbMessage.payload.playbackState !== 'string' ||
            !['playing', 'paused', 'stopped'].includes(pbMessage.payload.playbackState)
          ) {
            log.warn('Invalid PLAYBACK_UPDATE payload received.');
            return false;
          }
          this.handlePlaybackUpdate(pbMessage);
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

  public static validateTrackPayload(payload: any): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    // Required fields: title, artist, url must be non-empty strings
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      return false;
    }
    if (typeof payload.artist !== 'string' || !payload.artist.trim()) {
      return false;
    }
    if (typeof payload.url !== 'string' || !payload.url.trim()) {
      return false;
    }

    // Optional fields if defined
    if (payload.artwork !== undefined && typeof payload.artwork !== 'string') {
      return false;
    }

    if (payload.duration !== undefined) {
      if (
        typeof payload.duration !== 'number' ||
        !Number.isFinite(payload.duration) ||
        payload.duration < 0
      ) {
        return false;
      }
    }

    if (payload.playbackPosition !== undefined) {
      if (
        typeof payload.playbackPosition !== 'number' ||
        !Number.isFinite(payload.playbackPosition) ||
        payload.playbackPosition < 0
      ) {
        return false;
      }
    }

    if (payload.timingObservedAt !== undefined) {
      if (
        typeof payload.timingObservedAt !== 'number' ||
        !Number.isFinite(payload.timingObservedAt) ||
        payload.timingObservedAt <= 0
      ) {
        return false;
      }
    }

    if (payload.timingSource !== undefined) {
      const knownSources = ['media-element', 'soundcloud-dom', 'cache-derived', 'unavailable'];
      if (
        typeof payload.timingSource !== 'string' ||
        !knownSources.includes(payload.timingSource)
      ) {
        return false;
      }
    }

    if (payload.isPlaying !== undefined && typeof payload.isPlaying !== 'boolean') {
      return false;
    }

    if (payload.providerId !== undefined && typeof payload.providerId !== 'string') {
      return false;
    }

    return true;
  }

  private handleTrackUpdate(message: TrackUpdateMessage): void {
    const {
      title,
      artist,
      url,
      artwork,
      duration,
      isPlaying,
      playbackPosition,
      timingObservedAt,
      timingSource,
      providerId,
    } = message.payload;

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
      playbackPosition,
      timingObservedAt,
      timingSource,
    };

    log.debug('[DEV-LOG] MessageHandler raw timing:', {
      rawPlaybackPosition: playbackPosition,
      rawDuration: duration,
    });

    const sanitizedTrack = PrivacySanitizer.sanitizeTrack(rawTrack);

    log.debug('[DEV-LOG] MessageHandler sanitized timing:', {
      sanitizedPlaybackPosition: sanitizedTrack.playbackPosition,
      sanitizedDuration: sanitizedTrack.duration,
    });

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
