import { TypedEventEmitter, Track, PlaybackState } from '@waverpc/shared';
import { DiscordRPCClient } from '../rpc/discord.client.js';
import { PresenceMapper } from './presence.mapper.js';
import { PresenceManagerOptions, DiscordActivityPayload } from './types.js';

export class PresenceManager {
  private rpcClient: DiscordRPCClient;
  private currentTrack?: Track;
  private currentPlaybackState: PlaybackState = 'stopped';
  private currentProviderName: string = 'WaveRPC';
  private activeActivity?: DiscordActivityPayload;

  constructor(
    private events: TypedEventEmitter,
    options: PresenceManagerOptions
  ) {
    this.rpcClient = new DiscordRPCClient({
      clientId: options.clientId,
      autoReconnect: true,
    });

    this.setupEventListeners();
  }

  public async initialize(): Promise<boolean> {
    console.log('[PresenceManager] Initializing Presence Manager...');
    return this.rpcClient.connect();
  }

  public async shutdown(): Promise<void> {
    console.log('[PresenceManager] Shutting down Presence Manager...');
    await this.rpcClient.clearActivity();
    await this.rpcClient.disconnect();
  }

  private setupEventListeners(): void {
    this.events.on('track:changed', (track) => {
      this.handleTrackChanged(track);
    });

    this.events.on('playback:stateChanged', (state) => {
      this.handlePlaybackStateChanged(state);
    });

    this.events.on('provider:activated', (providerId) => {
      this.currentProviderName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
      this.updatePresence();
    });
  }

  private handleTrackChanged(track: Track | undefined): void {
    console.log('[PresenceManager] Track changed:', track?.title);
    this.currentTrack = track;
    if (track) {
      this.currentPlaybackState = track.isPlaying ? 'playing' : 'paused';
    } else {
      this.currentPlaybackState = 'stopped';
    }
    this.updatePresence();
  }

  private handlePlaybackStateChanged(state: PlaybackState): void {
    console.log('[PresenceManager] Playback state changed:', state);
    this.currentPlaybackState = state;
    if (this.currentTrack) {
      this.currentTrack.isPlaying = state === 'playing';
    }
    this.updatePresence();
  }

  private updatePresence(): void {
    const activity = PresenceMapper.mapTrackToActivity(
      this.currentTrack,
      this.currentPlaybackState,
      this.currentProviderName
    );

    this.activeActivity = activity;

    if (activity) {
      console.log(`[PresenceManager] Setting activity: "${activity.details}" ${activity.state}`);
      this.rpcClient.setActivity(activity).catch((err) => {
        console.error('[PresenceManager] Failed to set activity:', err);
      });
    } else {
      console.log('[PresenceManager] Clearing activity');
      this.rpcClient.clearActivity().catch((err) => {
        console.error('[PresenceManager] Failed to clear activity:', err);
      });
    }
  }

  public getActiveActivity(): DiscordActivityPayload | undefined {
    return this.activeActivity;
  }
}
