import { TypedEventEmitter, Track, PlaybackState, Logger, withTimeout } from '@waverpc/shared';
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
  private logicalStartTime?: number;
  private isShuttingDown = false;

  private lastTrackIdentity?: string;
  private lastPlaybackPosition?: number;
  private lastPlaybackPositionTime?: number;

  constructor(
    private events: TypedEventEmitter,
    options: PresenceManagerOptions
  ) {
    this.rpcClient = new DiscordRPCClient({
      clientId: options.clientId,
      autoReconnect: true,
      onStateChange: (state) => {
        if (state === 'READY') {
          this.events.emit('discord:connected');
          if (this.currentTrack && !this.isShuttingDown) {
            this.updatePresence();
          }
        } else if (state === 'DISCONNECTED') {
          this.presenceState = 'UNKNOWN';
          this.lastAppliedSignature = null;
          this.events.emit('discord:disconnected');
        } else {
          this.presenceState = 'UNKNOWN';
          this.lastAppliedSignature = null;
        }
      },
    });

    this.setupEventListeners();
  }

  public isConnected(): boolean {
    return this.rpcClient.ConnectionState === 'READY';
  }

  public async initialize(): Promise<boolean> {
    log.info('Initializing Presence Manager...');
    return this.rpcClient.connect();
  }

  public async shutdown(): Promise<void> {
    log.info('Shutting down Presence Manager...');
    this.isShuttingDown = true;
    try {
      if (this.presenceState === 'ACTIVE') {
        const cleared = await withTimeout(
          this.rpcClient.clearActivity(),
          2000,
          false,
          'PresenceManager clearActivity on shutdown',
          log
        );
        if (cleared) {
          this.presenceState = 'CLEARED';
          this.lastAppliedSignature = null;
          log.info('Presence successfully cleared on shutdown.');
        }
      }
    } catch (err) {
      log.error('Failed to clear activity on shutdown:', err);
    } finally {
      await this.rpcClient.disconnect();
    }
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
    if (track) {
      const identity = this.getNormalizedTrackIdentity(track);
      const isNewTrack = !this.currentTrack || identity !== this.lastTrackIdentity;
      if (isNewTrack) {
        log.info('Track changed:', track.title);
      } else {
        log.debug('Track updated:', track.title);
      }

      log.debug('[DEV-LOG] PresenceManager track update received:', {
        title: track.title,
        playbackPosition: track.playbackPosition,
        duration: track.duration,
        isPlaying: track.isPlaying,
      });

      if (isNewTrack) {
        this.logicalStartTime = undefined;
        this.lastTrackIdentity = identity;
        this.lastPlaybackPosition = undefined;
        this.lastPlaybackPositionTime = undefined;
      }
      this.currentTrack = track;
      this.currentPlaybackState = track.isPlaying ? 'playing' : 'paused';
    } else {
      log.info('Track cleared');
      this.currentTrack = undefined;
      this.currentPlaybackState = 'stopped';
      this.logicalStartTime = undefined;
      this.lastTrackIdentity = undefined;
      this.lastPlaybackPosition = undefined;
      this.lastPlaybackPositionTime = undefined;
    }

    this.updatePresence();
  }

  private handlePlaybackStateChanged(state: PlaybackState): void {
    log.info('Playback state changed:', state);

    if (state === 'playing' && this.currentPlaybackState !== 'playing') {
      this.logicalStartTime = undefined;
      this.lastPlaybackPosition = undefined;
      this.lastPlaybackPositionTime = undefined;
    }

    this.currentPlaybackState = state;
    if (this.currentTrack) {
      this.currentTrack.isPlaying = state === 'playing';
    }
    this.updatePresence();
  }

  private updatePresence(): void {
    if (this.isShuttingDown) {
      return;
    }

    // Check for track identity change
    if (this.currentTrack) {
      const identity = this.getNormalizedTrackIdentity(this.currentTrack);
      if (identity !== this.lastTrackIdentity) {
        log.debug(`[DEV-LOG] PresenceManager: NEW_TRACK detected. Clearing logical anchor.`);
        this.logicalStartTime = undefined;
        this.lastTrackIdentity = identity;
        this.lastPlaybackPosition = undefined;
        this.lastPlaybackPositionTime = undefined;
      }
    } else {
      this.logicalStartTime = undefined;
      this.lastTrackIdentity = undefined;
      this.lastPlaybackPosition = undefined;
      this.lastPlaybackPositionTime = undefined;
    }

    // Calculate logical start time if playing and position is valid
    if (this.currentTrack && this.currentPlaybackState === 'playing') {
      const playbackPosition = this.currentTrack.playbackPosition;
      const duration = this.currentTrack.duration;
      // Use timingObservedAt if present, otherwise fallback to Date.now()
      const observedAt = this.currentTrack.timingObservedAt ?? Date.now();
      let hasValidPosition = false;

      if (
        playbackPosition !== undefined &&
        typeof playbackPosition === 'number' &&
        Number.isFinite(playbackPosition) &&
        playbackPosition >= 0
      ) {
        hasValidPosition = true;
      }

      if (hasValidPosition) {
        let clampedPosition = playbackPosition!;
        if (
          duration !== undefined &&
          typeof duration === 'number' &&
          Number.isFinite(duration) &&
          duration > 0
        ) {
          if (clampedPosition > duration) {
            clampedPosition = duration;
          }
        }

        const candidateStart = observedAt - clampedPosition;

        if (this.logicalStartTime === undefined) {
          if (this.lastPlaybackPosition !== undefined) {
            // We had a position but no start time (e.g. paused -> playing)
            log.debug('[DEV-LOG] PresenceManager timing decision:', {
              decision: 'RESUME_REANCHOR',
            });
          } else {
            log.debug('[DEV-LOG] PresenceManager timing decision:', {
              decision: 'TIMING_ACQUIRED',
            });
          }
          this.logicalStartTime = candidateStart;
          this.lastPlaybackPosition = clampedPosition;
          this.lastPlaybackPositionTime = observedAt;
        } else {
          // Compare observation to observation
          const positionDelta = clampedPosition - this.lastPlaybackPosition!;
          const observationElapsed = observedAt - this.lastPlaybackPositionTime!;

          let decision = 'NORMAL_PROGRESSION';

          if (observedAt < this.lastPlaybackPositionTime!) {
            decision = 'OUT_OF_ORDER_IGNORED';
            // Do not re-anchor, just log
          } else if (positionDelta <= 1000 && observationElapsed > 2000) {
            // Position barely moved, but observation time advanced significantly. STALE_QUANTIZED.
            decision = 'STALE_QUANTIZED';
          } else if (positionDelta < -3000) {
            decision = 'BACKWARD_SEEK';
            this.logicalStartTime = candidateStart;
          } else if (positionDelta > observationElapsed + 3000) {
            decision = 'FORWARD_SEEK';
            this.logicalStartTime = candidateStart;
          } else {
            // Normal progression, keep anchor. But if positionDelta == 0 and elapsed == 0, it's just a duplicate packet
            if (positionDelta === 0 && observationElapsed === 0) {
              decision = 'RESYNC_KEEP_ANCHOR';
            }
          }

          log.debug('[DEV-LOG] PresenceManager timing decision:', {
            trackIdentity: this.lastTrackIdentity,
            previousPosition: this.lastPlaybackPosition,
            newPosition: clampedPosition,
            previousObservedAt: this.lastPlaybackPositionTime,
            newObservedAt: observedAt,
            observationElapsed,
            positionDelta,
            decision,
            logicalStartTimeBefore:
              this.logicalStartTime !== candidateStart ? this.logicalStartTime : candidateStart,
            logicalStartTimeAfter: this.logicalStartTime,
          });

          // Only update local tracking references if not out of order
          if (decision !== 'OUT_OF_ORDER_IGNORED') {
            this.lastPlaybackPosition = clampedPosition;
            this.lastPlaybackPositionTime = observedAt;
          }
        }
      } else {
        if (this.logicalStartTime !== undefined) {
          log.debug('[DEV-LOG] PresenceManager timing decision:', {
            decision: 'TIMINGLESS_PRESERVE',
          });
        } else {
          log.debug('[DEV-LOG] PresenceManager timing decision:', { decision: 'TIMINGLESS_WAIT' });
        }
      }
    } else if (this.currentPlaybackState === 'paused') {
      log.debug(
        '[DEV-LOG] PresenceManager: PAUSE_CLEAR. Presence will be cleared, local state retained.'
      );
      this.logicalStartTime = undefined;
      // We retain lastPlaybackPosition, lastPlaybackPositionTime, lastDuration so resume can re-anchor.
    } else {
      this.logicalStartTime = undefined;
      this.lastPlaybackPosition = undefined;
      this.lastPlaybackPositionTime = undefined;
    }

    let mapperStartTime = this.logicalStartTime;

    const activity = PresenceMapper.mapTrackToActivity(
      this.currentTrack,
      this.currentPlaybackState,
      this.currentProviderName,
      mapperStartTime
    );

    this.activeActivity = activity;

    if (!this.isConnected()) {
      log.debug('Discord RPC is not ready. Retaining local track state.');
      this.lastAppliedSignature = null;
      return;
    }

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
          if (this.isShuttingDown) return;
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
          if (this.isShuttingDown) return;
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

  private getNormalizedTrackIdentity(track: Track | undefined): string {
    if (!track) return '';

    // 1. Preferred: canonical SoundCloud track URL/path if valid
    let canonicalUrl = '';
    if (track.url) {
      try {
        const parsed = new URL(track.url);
        if (parsed.hostname === 'soundcloud.com' || parsed.hostname.endsWith('.soundcloud.com')) {
          parsed.search = '';
          parsed.hash = '';
          canonicalUrl = parsed.toString().toLowerCase().trim();
        }
      } catch {
        // Ignore
      }
    }

    if (canonicalUrl) {
      return `url:${canonicalUrl}`;
    }

    // 2. otherwise normalized title + normalized artist
    let title = (track.title || '').trim();
    if (title.toLowerCase().startsWith('current track:')) {
      title = title.substring('current track:'.length).trim();
    }
    title = title.replace(/\s+/g, ' ').toLowerCase();

    const artist = (track.artist || '').trim().replace(/\s+/g, ' ').toLowerCase();

    return `meta:${artist}|${title}`;
  }
}
