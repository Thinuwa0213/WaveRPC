import { Track, PlaybackState } from '@waverpc/shared';
import { DiscordActivityPayload } from './types.js';

export class PresenceMapper {
  public static mapTrackToActivity(
    track: Track | undefined,
    playbackState: PlaybackState,
    providerName: string = 'WaveRPC'
  ): DiscordActivityPayload | undefined {
    if (!track || playbackState === 'stopped') {
      return undefined;
    }

    const isPlaying = playbackState === 'playing';
    const now = Date.now();

    let timestamps: DiscordActivityPayload['timestamps'] = undefined;
    if (isPlaying && track.duration && track.duration > 0) {
      timestamps = {
        start: now,
        end: now + track.duration,
      };
    } else if (isPlaying) {
      timestamps = {
        start: now,
      };
    }

    const details = track.title || 'Unknown Track';
    const state = `by ${track.artist || 'Unknown Artist'}${!isPlaying ? ' (Paused)' : ''}`;

    const assets: DiscordActivityPayload['assets'] = {
      large_image: track.artwork || 'default_music',
      large_text: track.title,
      small_image: isPlaying ? 'play_icon' : 'pause_icon',
      small_text: isPlaying ? 'Playing' : 'Paused',
    };

    const buttons: DiscordActivityPayload['buttons'] = track.url
      ? [
          {
            label: `Listen on ${providerName}`,
            url: track.url,
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
