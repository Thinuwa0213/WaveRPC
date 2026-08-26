import { TypedEventEmitter, Track, PlaybackState, Logger } from '@waverpc/shared';
import { DiscordRPCClient } from '../rpc/discord.client.js';
import { PresenceMapper } from './presence.mapper.js';
import { PresenceManagerOptions, DiscordActivityPayload } from './types.js';

const log = new Logger('PresenceManager');

export type PresenceState = 'UNKNOWN' | 'ACTIVE' | 'CLEARED';

export class PresenceManager {
  private rpcClient: DiscordRPCClient;
  private currentTrack?: Track;
  private currentPlaybackState: PlaybackState = 'stopped';
  private currentProviderName: string = 'WaveRPC';
  private activeActivity?: DiscordActivityPayload;
  private lastAppliedSignature: string | null = null;
  private presenceState: PresenceState = 'UNKNOWN';
  private presenceRevision: number = 0;
  private trackStartTime?: number;

  constructor(
    private events: TypedEventEmitter,
    options: PresenceManagerOptions
  ) {
    this.rpcClient = new DiscordRPCClient({
      clientId: options.clientId,
      autoReconnect: true,
      onStateChange: (state) => {
        if (state === 'CONNECTED') {
          this.events.emit('discord:connected');
        } else if (state === 'DISCONNECTED') {
          this.presenceState = 'UNKNOWN';
          this.lastAppliedSignature = null;
          this.events.emit('discord:disconnected');
        }
      },
    });

    this.setupEventListeners();
  }

  public isConnected(): boolean {
    return this.rpcClient.ConnectionState === 'CONNECTED';
  }

  public async initialize(): Promise<boolean> {
    log.info('Initializing Presence Manager...');
    return this.rpcClient.connect();
  }

  public async shutdown(): Promise<void> {
    log.info('Shutting down Presence Manager...');
    if (this.presenceState === 'ACTIVE') {
      try {
        const clearPromise = this.rpcClient.clearActivity();
        const timeoutPromise = new Promise<boolean>((resolve) => {
          setTimeout(() => {
            log.warn('Discord clearActivity timed out during shutdown.');
            resolve(false);
          }, 2000);
        });

        const cleared = await Promise.race([clearPromise, timeoutPromise]);
        if (cleared) {
          this.presenceState = 'CLEARED';
          this.lastAppliedSignature = null;
          log.info('Presence successfully cleared on shutdown.');
        }
      } catch (err) {
        log.error('Failed to clear activity on shutdown:', err);
      }
    }
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
      log.info(`Provider activated: ${providerId}`);
      this.currentProviderName =
        providerId === 'soundcloud'
          ? 'SoundCloud'
          : providerId.charAt(0).toUpperCase() + providerId.slice(1);
      if (this.currentTrack) {
        this.updatePresence();
      }
    });
  }

  private handleTrackChanged(track: Track | undefined): void {
    log.info('Track changed:', track?.title);

    if (
      track &&
      this.currentTrack &&
      track.url === this.currentTrack.url &&
      track.title === this.currentTrack.title
    ) {
      // Retain trackStartTime for same track
    } else if (track) {
      this.trackStartTime = Date.now();
    } else {
      this.trackStartTime = undefined;
    }

    this.currentTrack = track;
    if (track) {
      this.currentPlaybackState = track.isPlaying ? 'playing' : 'paused';
    } else {
      this.currentPlaybackState = 'stopped';
    }
    this.updatePresence();
  }

  private handlePlaybackStateChanged(state: PlaybackState): void {
    log.info('Playback state changed:', state);

    if (state === 'playing' && this.currentPlaybackState !== 'playing') {
      if (!this.trackStartTime) {
        this.trackStartTime = Date.now();
      }
    }

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
      this.currentProviderName,
      this.trackStartTime
    );

    this.activeActivity = activity;

    if (activity) {
      const signature = JSON.stringify(activity);
      if (this.presenceState === 'ACTIVE' && signature === this.lastAppliedSignature) {
        log.debug('Duplicate presence update skipped.');
        return;
      }

      const currentRevision = ++this.presenceRevision;

      this.rpcClient
        .setActivity(activity)
        .then((success) => {
          if (currentRevision !== this.presenceRevision) {
            log.debug('Presence update ignored: newer update is in progress or completed.');
            return;
          }

          if (success) {
            this.lastAppliedSignature = signature;
            this.presenceState = 'ACTIVE';
            log.info(
              `Presence update successfully applied: "${activity.details}" ${activity.state}`
            );
          } else {
            log.warn('Failed to set activity: Discord RPC returned false');
          }
        })
        .catch((err) => {
          if (currentRevision !== this.presenceRevision) return;
          log.error('Failed to set activity:', err);
        });
    } else {
      if (this.presenceState === 'CLEARED' || this.presenceState === 'UNKNOWN') {
        log.debug('Duplicate presence clear skipped.');
        return;
      }

      log.info('Clearing Discord presence: no active track.');
      const currentRevision = ++this.presenceRevision;

      this.rpcClient
        .clearActivity()
        .then((success) => {
          if (currentRevision !== this.presenceRevision) {
            log.debug('Presence clear ignored: newer update is in progress or completed.');
            return;
          }

          if (success) {
            this.lastAppliedSignature = null;
            this.presenceState = 'CLEARED';
            log.info('Presence successfully cleared.');
          } else {
            log.warn('Failed to clear activity: Discord RPC returned false');
          }
        })
        .catch((err) => {
          if (currentRevision !== this.presenceRevision) return;
          log.error('Failed to clear activity:', err);
        });
    }
  }

  public getActiveActivity(): DiscordActivityPayload | undefined {
    return this.activeActivity;
  }
}
