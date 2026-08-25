import { BaseProvider } from '../base.js';
import { Track, PlaybackState, ProviderMetadata } from '@waverpc/shared';
import { MockProviderOptions, MockState } from './types.js';

export class MockProvider extends BaseProvider {
  public readonly metadata: ProviderMetadata = {
    id: 'mock',
    name: 'Mock Music Provider',
    version: '1.0.0',
    supportedDomains: ['mockmusic.local'],
  };

  private state: MockState;

  constructor(options?: MockProviderOptions) {
    super();
    const defaultTrack: Track = options?.defaultTrack ?? {
      title: 'Synthwave Dreams',
      artist: 'Retro Wave',
      url: 'https://mockmusic.local/track/synthwave-dreams',
      artwork: 'https://mockmusic.local/art/synthwave.png',
      duration: 210000,
      isPlaying: options?.autoPlay ?? true,
    };

    this.state = {
      currentTrack: defaultTrack,
      playbackState: defaultTrack.isPlaying ? 'playing' : 'paused',
    };
  }

  public isSupported(_context?: unknown): boolean {
    return true;
  }

  public getCurrentTrack(): Track | undefined {
    return this.state.currentTrack;
  }

  public getPlaybackState(): PlaybackState {
    return this.state.playbackState;
  }

  public setMockTrack(track: Track | undefined): void {
    this.state.currentTrack = track;
    this.state.playbackState = track ? (track.isPlaying ? 'playing' : 'paused') : 'stopped';
  }

  public setPlaybackState(state: PlaybackState): void {
    this.state.playbackState = state;
    if (this.state.currentTrack) {
      this.state.currentTrack.isPlaying = state === 'playing';
    }
  }

  public togglePlayback(): PlaybackState {
    const newState: PlaybackState = this.state.playbackState === 'playing' ? 'paused' : 'playing';
    this.setPlaybackState(newState);
    return newState;
  }
}

export * from './types.js';
