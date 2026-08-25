import { BaseProvider } from '../base.js';
import { Track, PlaybackState, ProviderMetadata } from '@waverpc/shared';
import { SoundCloudDetector } from './detector.js';

export class SoundCloudProvider extends BaseProvider {
  public readonly metadata: ProviderMetadata = {
    id: 'soundcloud',
    name: 'SoundCloud',
    version: '1.0.0',
    supportedDomains: ['soundcloud.com'],
  };

  private detector: SoundCloudDetector;

  constructor() {
    super();
    this.detector = new SoundCloudDetector();
  }

  public isSupported(url?: unknown): boolean {
    if (typeof url === 'string') {
      return this.detector.isSoundCloudPage(url);
    }
    return false;
  }

  public getCurrentTrack(): Track | undefined {
    const metadata = this.detector.detectTrack();
    if (!metadata || !metadata.trackTitle || !metadata.artistName || !metadata.permalinkUrl) {
      return undefined;
    }

    return {
      title: metadata.trackTitle,
      artist: metadata.artistName,
      url: metadata.permalinkUrl,
      artwork: metadata.artworkUrl,
      duration: metadata.durationMs,
      isPlaying: metadata.isPlaying ?? false,
    };
  }

  public getPlaybackState(): PlaybackState {
    const track = this.getCurrentTrack();
    if (!track) return 'stopped';
    return track.isPlaying ? 'playing' : 'paused';
  }
}

export * from './types.js';
export * from './detector.js';
