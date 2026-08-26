import { TypedEventEmitter, Logger, withTimeout } from '@waverpc/shared';
import { DiscordService } from '../services/discord.service.js';
import { ProviderService } from '../services/provider.service.js';
import { IPCService } from '../services/ipc.service.js';
import { WaveRPCWebSocketServer } from '../server/websocket.server.js';
import { StatusService } from '../services/status.service.js';
import { SettingsService } from '../services/settings.service.js';

import { ElectronApp } from './electron-app.js';
import { resolveAppVersion } from './app-version.js';
import * as fs from 'fs';
import * as path from 'path';
import { defaultConfig } from '../config/default.js';

const log = new Logger('WaveRPCDesktop');

function loadEnv(): void {
  const cwdEnv = path.join(process.cwd(), '.env');
  const desktopEnv = path.join(__dirname, '../../.env');
  const workspaceEnv = path.join(__dirname, '../../../../.env');

  const envFiles = [cwdEnv, desktopEnv, workspaceEnv];

  for (const filePath of envFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            continue;
          }
          const equalIndex = trimmed.indexOf('=');
          if (equalIndex <= 0) {
            continue;
          }
          const key = trimmed.substring(0, equalIndex).trim();
          const val = trimmed
            .substring(equalIndex + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '');

          if (key && process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
        log.info(`Environment variables loaded from: ${filePath}`);
      } catch (err: any) {
        log.error(`Failed to read environment configuration file ${filePath}:`, err.message);
      }
    }
  }
}

// Initialize environment configuration
loadEnv();

export class WaveRPCDesktopApp {
  private events: TypedEventEmitter;
  private discordService: DiscordService;
  private providerService: ProviderService;
  private ipcService: IPCService;
  private wsServer: WaveRPCWebSocketServer;
  private statusService: StatusService;
  private settingsService: SettingsService;
  private disconnectGracePeriodMs: number;
  private disconnectTimeout: NodeJS.Timeout | null = null;
  private lastRequestStateTime = 0;

  constructor(options?: { disconnectGracePeriodMs?: number; clientId?: string; port?: number }) {
    this.disconnectGracePeriodMs = options?.disconnectGracePeriodMs ?? 5000;
    const clientId =
      options?.clientId || process.env.DISCORD_CLIENT_ID || defaultConfig.discordClientId;
    const port =
      options?.port !== undefined
        ? options.port
        : process.env.WAVERPC_PORT !== undefined
          ? parseInt(process.env.WAVERPC_PORT, 10)
          : defaultConfig.defaultPort;
    this.events = new TypedEventEmitter();
    this.discordService = new DiscordService(this.events, clientId);
    this.providerService = new ProviderService(this.events);
    this.ipcService = new IPCService(this.events);
    this.wsServer = new WaveRPCWebSocketServer(this.events, { port });
    this.statusService = new StatusService(this.events, this.discordService, this.wsServer);
    this.settingsService = new SettingsService(undefined, this.events);
  }

  public async bootstrap(): Promise<void> {
    log.info(`Starting WaveRPC Desktop v${resolveAppVersion()}...`);
    this.settingsService.load();
    this.statusService.initialize();
    this.ipcService.initialize();

    await this.discordService.connect();
    await this.wsServer.start();

    if (process.env.WAVERPC_DEV_MOCK === 'true') {
      const activeProviderId = await this.providerService.detectActiveProvider(
        'https://mockmusic.local/track/synthwave-dreams'
      );
      log.info(`Active Provider: ${activeProviderId}`);

      const mockProvider = this.providerService.getRegistry().getProvider('mock');
      if (mockProvider) {
        const track = await mockProvider.getCurrentTrack();
        this.providerService.setTrack(track);
      }
    }

    log.info('Bootstrap complete. Waiting for extension connections...');

    let activeTrack: any = undefined;
    let trackedProviderId: string | undefined = undefined;

    this.events.on('track:changed', (track) => {
      activeTrack = track;
      if (track === undefined) {
        if (this.disconnectTimeout) {
          log.info('Authoritative TRACK_CLEAR received. Cancelling grace period timer.');
          clearTimeout(this.disconnectTimeout);
          this.disconnectTimeout = null;
        }
        if (trackedProviderId === 'soundcloud') {
          log.info('SoundCloud track cleared. Deactivating SoundCloud provider.');
          this.providerService.getRegistry().setActiveProvider(null);
          this.events.emit('provider:deactivated', 'soundcloud');
        }
      }
    });

    this.events.on('provider:activated', (providerId) => {
      trackedProviderId = providerId;
    });

    this.events.on('provider:deactivated', () => {
      trackedProviderId = undefined;
    });

    this.events.on('extension:connected', () => {
      this.lastRequestStateTime = Date.now();
      if (this.disconnectTimeout) {
        log.info('Extension reconnected during grace period. Cancelling disconnect timeout.');
        clearTimeout(this.disconnectTimeout);
        this.disconnectTimeout = null;
      }
    });

    this.events.on('discord:connected', () => {
      const now = Date.now();
      if (now - this.lastRequestStateTime > 2000) {
        log.info('Discord RPC is ready. Requesting state resync from extensions...');
        this.lastRequestStateTime = now;
        this.wsServer.broadcast({ type: 'REQUEST_STATE' });
      } else {
        log.info(
          'Discord RPC is ready, but state resync was requested recently. Skipping duplicate.'
        );
      }
    });

    this.events.on('extension:disconnected', () => {
      if (this.wsServer.hasConnectedClients()) {
        log.info(
          'An extension client disconnected, but other clients remain connected. Skipping grace period timer.'
        );
        return;
      }

      if (this.disconnectTimeout) {
        log.warn('Extension disconnect timer was already active. Resetting timer.');
        clearTimeout(this.disconnectTimeout);
        this.disconnectTimeout = null;
      }

      if (this.disconnectGracePeriodMs === 0) {
        log.info(
          'Final extension client disconnected. Grace period is 0. Performing immediate state cleanup.'
        );
        if (activeTrack !== undefined) {
          this.events.emit('track:changed', undefined);
        }
        if (trackedProviderId !== undefined) {
          this.providerService.getRegistry().setActiveProvider(null);
          this.events.emit('provider:deactivated', trackedProviderId);
        }
        return;
      }

      log.info(
        `Final extension client disconnected. Starting ${this.disconnectGracePeriodMs}ms grace period timer.`
      );
      this.disconnectTimeout = setTimeout(() => {
        this.disconnectTimeout = null;
        if (!this.wsServer.hasConnectedClients()) {
          log.info(
            'Grace period expired with no extension client connected. Performing state cleanup.'
          );
          if (activeTrack !== undefined) {
            log.info('Clearing active track due to grace period expiry.');
            this.events.emit('track:changed', undefined);
          }

          if (trackedProviderId !== undefined) {
            log.info(`Deactivating provider "${trackedProviderId}" due to grace period expiry.`);
            this.providerService.getRegistry().setActiveProvider(null);
            this.events.emit('provider:deactivated', trackedProviderId);
          }
        }
      }, this.disconnectGracePeriodMs);
    });
  }

  public async shutdown(): Promise<void> {
    log.info('Shutting down WaveRPC Desktop...');

    if (this.disconnectTimeout) {
      log.info('Cancelling active disconnect grace period timer during shutdown.');
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }

    try {
      await withTimeout(
        this.discordService.disconnect(),
        3000,
        undefined,
        'DiscordService.disconnect',
        log
      );
      log.info('Discord IPC disconnected.');
    } catch (err) {
      log.error('Error during Discord service shutdown:', err);
    }

    try {
      await withTimeout(this.wsServer.stop(), 3000, undefined, 'WebSocketServer.stop', log);
      log.info('WebSocket server stopped.');
    } catch (err) {
      log.error('Error during WebSocket server shutdown:', err);
    }

    this.events.removeAllListeners();
    log.info('Presence manager shutdown complete.');
    log.info('Runtime shutdown complete.');
  }

  public getStatusService(): StatusService {
    return this.statusService;
  }

  public getSettingsService(): SettingsService {
    return this.settingsService;
  }

  public getEvents(): TypedEventEmitter {
    return this.events;
  }
}

// Start the Electron application coordinator
if (process.versions.electron) {
  new ElectronApp();
}
