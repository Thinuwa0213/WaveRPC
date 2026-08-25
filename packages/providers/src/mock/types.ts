import { Track, PlaybackState } from '@waverpc/shared';

export interface MockProviderOptions {
  autoPlay?: boolean;
  defaultTrack?: Track;
}

export interface MockState {
  currentTrack?: Track;
  playbackState: PlaybackState;
}
