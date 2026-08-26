export interface Track {
  title: string;
  artist: string;
  url: string;
  artwork?: string;
  duration?: number;
  isPlaying: boolean;
  playbackPosition?: number;
  timingObservedAt?: number;
  timingSource?: 'media-element' | 'soundcloud-dom' | 'cache-derived' | 'unavailable';
}
