import { Track } from '../types/track.js';

export class PrivacySanitizer {
  /**
   * Sanitizes a track payload to ensure data minimization compliance.
   * Strips authentication query parameters, access tokens, and limits text length.
   */
  public static sanitizeTrack(track: Track): Track {
    const sanitizedDuration =
      track.duration && track.duration > 0 ? Math.round(track.duration) : undefined;

    let playbackPosition: number | undefined;
    if (
      track.playbackPosition !== undefined &&
      typeof track.playbackPosition === 'number' &&
      Number.isFinite(track.playbackPosition) &&
      track.playbackPosition >= 0
    ) {
      playbackPosition = Math.round(track.playbackPosition);
      if (sanitizedDuration !== undefined && playbackPosition > sanitizedDuration) {
        playbackPosition = sanitizedDuration;
      }
    }

    let timingObservedAt: number | undefined;
    if (
      track.timingObservedAt !== undefined &&
      typeof track.timingObservedAt === 'number' &&
      Number.isFinite(track.timingObservedAt) &&
      track.timingObservedAt > 0
    ) {
      timingObservedAt = Math.round(track.timingObservedAt);
    }

    let timingSource:
      'media-element' | 'soundcloud-dom' | 'cache-derived' | 'unavailable' | undefined;
    if (track.timingSource !== undefined) {
      const validSources = ['media-element', 'soundcloud-dom', 'cache-derived', 'unavailable'];
      if (validSources.includes(track.timingSource)) {
        timingSource = track.timingSource as typeof timingSource;
      }
    }

    return {
      title: this.cleanText(track.title, 128),
      artist: this.cleanText(track.artist, 128),
      url: this.sanitizeUrl(track.url),
      artwork: track.artwork ? this.sanitizeUrl(track.artwork) : undefined,
      duration: sanitizedDuration,
      isPlaying: Boolean(track.isPlaying),
      playbackPosition,
      timingObservedAt,
      timingSource,
    };
  }

  /**
   * Cleans text input, stripping control characters and truncating long strings.
   */
  public static cleanText(text: string, maxLength: number = 128): string {
    if (!text) return '';
    return text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .trim()
      .slice(0, maxLength);
  }

  /**
   * Sanitizes URLs by removing sensitive query parameters (oauth, tokens, session IDs).
   */
  public static sanitizeUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    try {
      const url = new URL(rawUrl);
      const sensitiveParams = [
        'access_token',
        'token',
        'auth',
        'bearer',
        'session_id',
        'client_secret',
        'key',
        'api_key',
      ];
      for (const param of sensitiveParams) {
        url.searchParams.delete(param);
      }
      return url.toString();
    } catch {
      return rawUrl.split('?')[0] || '';
    }
  }
}
