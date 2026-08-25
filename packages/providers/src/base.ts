import { Track, PlaybackState, ProviderMetadata } from '@waverpc/shared';

export abstract class BaseProvider {
  public abstract readonly metadata: ProviderMetadata;

  /**
   * Checks whether this provider is supported in the current context
   */
  public abstract isSupported(context?: unknown): Promise<boolean> | boolean;

  /**
   * Retrieves current track info from the music service
   */
  public abstract getCurrentTrack(): Promise<Track | undefined> | Track | undefined;

  /**
   * Retrieves current playback state ('playing', 'paused', etc.)
   */
  public abstract getPlaybackState(): Promise<PlaybackState> | PlaybackState;
}
