import { Track, PlaybackState } from '@waverpc/shared';
import { DiscordActivityPayload } from './types.js';

export class PresenceMapper {
  public static mapTrackToActivity(
    track: Track | undefined,
    playbackState: PlaybackState,
    providerName: string = 'WaveRPC',
    startTime?: number
  ): DiscordActivityPayload | undefined {
    if (!track || playbackState === 'stopped') {
      return undefined;
    }

    const isPlaying = playbackState === 'playing';
    const now = startTime ?? Date.now();

    let timestamps: DiscordActivityPayload['timestamps'] = undefined;
    if (isPlaying) {
      if (
        track.playbackPosition !== undefined &&
        typeof track.playbackPosition === 'number' &&
        Number.isFinite(track.playbackPosition) &&
        track.playbackPosition >= 0
      ) {
        const start = now - track.playbackPosition;
        if (track.duration && track.duration > 0) {
          timestamps = {
            start: Math.round(start),
            end: Math.round(start + track.duration),
          };
        } else {
          timestamps = {
            start: Math.round(start),
          };
        }
      } else {
        if (track.duration && track.duration > 0) {
          timestamps = {
            start: Math.round(now),
            end: Math.round(now + track.duration),
          };
        } else {
          timestamps = {
            start: Math.round(now),
          };
        }
      }
    }

    const titleText = (track.title || 'Unknown Track').trim();
    const artistText = (track.artist || 'Unknown Artist').trim();

    const details = titleText.slice(0, 128);
    const stateRaw = isPlaying ? artistText : `${artistText} • Paused`;
    const state = stateRaw.slice(0, 128);

    const assets: DiscordActivityPayload['assets'] = {};

    if (track.artwork && typeof track.artwork === 'string' && track.artwork.trim().length > 0) {
      try {
        const parsedUrl = new URL(track.artwork.trim());
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          assets.large_image = parsedUrl.toString();
          assets.large_text = providerName.slice(0, 128);
        }
      } catch {
        // Invalid URL, omit large_image
      }
    }

    let buttons: DiscordActivityPayload['buttons'] = undefined;
    if (track.url && typeof track.url === 'string' && track.url.trim().length > 0) {
      try {
        const parsedUrl = new URL(track.url.trim());
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          buttons = [
            {
              label: `Listen on ${providerName}`.slice(0, 32),
              url: parsedUrl.toString(),
            },
          ];
        }
      } catch {
        // Invalid URL, omit buttons
      }
    }

    return {
      details,
      state,
      timestamps,
      assets: Object.keys(assets).length > 0 ? assets : undefined,
      buttons,
      instance: false,
      type: 2,
    };
  }
}
