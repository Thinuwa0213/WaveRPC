import { WaveRPCStatus, TypedEventEmitter, Logger } from '@waverpc/shared';
import { DiscordService } from './discord.service.js';
import { WaveRPCWebSocketServer } from '../server/websocket.server.js';

const log = new Logger('StatusService');

export class StatusService {
  private status: WaveRPCStatus;

  constructor(
    private events: TypedEventEmitter,
    private discordService: DiscordService,
    private wsServer: WaveRPCWebSocketServer
  ) {
    this.status = {
      discord: {
        connected: false,
      },
      extension: {
        connected: false,
      },
      provider: {
        active: false,
      },
      app: {
        running: true,
      },
    };
  }

  public initialize(): void {
    log.info('Initializing Status Service...');

    // Query initial states
    this.status.discord.connected = this.discordService.isConnected();
    this.status.extension.connected = this.wsServer.hasConnectedClients();

    // Set up listeners
    this.events.on('discord:connected', () => {
      if (!this.status.discord.connected) {
        this.status.discord.connected = true;
        this.notify();
      }
    });

    this.events.on('discord:disconnected', () => {
      if (this.status.discord.connected) {
        this.status.discord.connected = false;
        this.notify();
      }
    });

    this.events.on('extension:connected', () => {
      if (!this.status.extension.connected) {
        this.status.extension.connected = true;
        this.notify();
      }
    });

    this.events.on('extension:disconnected', () => {
      const isConnected = this.wsServer.hasConnectedClients();
      if (!isConnected) {
        let changed = false;
        if (this.status.extension.connected) {
          this.status.extension.connected = false;
          changed = true;
        }
        if (this.status.provider.active) {
          this.status.provider.active = false;
          this.status.provider.id = undefined;
          this.status.provider.name = undefined;
          changed = true;
        }
        if (this.status.track !== undefined) {
          this.status.track = undefined;
          changed = true;
        }
        if (changed) {
          this.notify();
        }
      } else {
        if (this.status.extension.connected !== isConnected) {
          this.status.extension.connected = isConnected;
          this.notify();
        }
      }
    });

    this.events.on('provider:activated', (providerId) => {
      const name =
        providerId === 'soundcloud'
          ? 'SoundCloud'
          : providerId.charAt(0).toUpperCase() + providerId.slice(1);
      if (
        !this.status.provider.active ||
        this.status.provider.id !== providerId ||
        this.status.provider.name !== name
      ) {
        this.status.provider.active = true;
        this.status.provider.id = providerId;
        this.status.provider.name = name;
        this.notify();
      }
    });

    this.events.on('provider:deactivated', () => {
      if (this.status.provider.active) {
        this.status.provider.active = false;
        this.status.provider.id = undefined;
        this.status.provider.name = undefined;
        this.notify();
      }
    });

    this.events.on('track:changed', (track) => {
      if (track) {
        const hasNoTrack = !this.status.track;
        const titleChanged = this.status.track?.title !== track.title;
        const artistChanged = this.status.track?.artist !== track.artist;
        const artworkChanged = this.status.track?.artwork !== track.artwork;
        const playingChanged = this.status.track?.isPlaying !== track.isPlaying;
        if (hasNoTrack || titleChanged || artistChanged || artworkChanged || playingChanged) {
          this.status.track = {
            title: track.title,
            artist: track.artist,
            artwork: track.artwork,
            isPlaying: track.isPlaying,
          };
          this.notify();
        }
      } else {
        if (this.status.track !== undefined) {
          this.status.track = undefined;
          this.notify();
        }
      }
    });

    this.events.on('playback:stateChanged', (state) => {
      if (this.status.track) {
        const isPlaying = state === 'playing';
        if (this.status.track.isPlaying !== isPlaying) {
          this.status.track.isPlaying = isPlaying;
          this.notify();
        }
      }
    });

    // Notify initial state
    this.notify();
  }

  public getStatus(): WaveRPCStatus {
    // Return a safe serialized snapshot
    return JSON.parse(JSON.stringify(this.status));
  }

  private notify(): void {
    const snapshot = this.getStatus();
    this.events.emit('status:changed', snapshot);
  }
}
