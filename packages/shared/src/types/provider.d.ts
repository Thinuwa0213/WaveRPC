import { Track } from './track.js';
export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'unknown';
export interface ProviderMetadata {
    id: string;
    name: string;
    version: string;
    supportedDomains: string[];
}
export interface ProviderState {
    providerId: string;
    isSupported: boolean;
    playbackState: PlaybackState;
    currentTrack?: Track;
}
//# sourceMappingURL=provider.d.ts.map