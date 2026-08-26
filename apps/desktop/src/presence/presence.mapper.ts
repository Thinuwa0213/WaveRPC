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
    if (isPlaying && track.duration && track.duration > 0) {
      timestamps = {
        start: now,
        end: now + Math.round(track.duration),
      };
    } else if (isPlaying) {
      timestamps = {
        start: now,
      };
    }

    const titleText = (track.title || 'Unknown Track').trim();
    const artistText = (track.artist || 'Unknown Artist').trim();

    const details = titleText.slice(0, 128);
    const stateRaw = `by ${artistText}${!isPlaying ? ' (Paused)' : ''}`;
    const state = stateRaw.slice(0, 128);

    const assets: DiscordActivityPayload['assets'] = {
      small_image: isPlaying ? 'play_icon' : 'pause_icon',
      small_text: isPlaying ? 'Playing' : 'Paused',
    };

    if (track.artwork && typeof track.artwork === 'string' && track.artwork.trim().length > 0) {
      assets.large_image = track.artwork.trim();
      assets.large_text = details;
    }

    const buttons: DiscordActivityPayload['buttons'] =
      track.url && typeof track.url === 'string' && track.url.trim().length > 0
        ? [
            {
              label: `Listen on ${providerName}`,
              url: track.url.trim(),
            },
          ]
        : undefined;

    return {
      details,
      state,
      timestamps,
      assets,
      buttons,
      instance: false,
    };
  }
}
