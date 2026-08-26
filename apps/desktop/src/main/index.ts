import { TypedEventEmitter, Logger } from '@waverpc/shared';
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

  constructor() {
    const clientId = process.env.DISCORD_CLIENT_ID || '123456789012345678';
    this.events = new TypedEventEmitter();
    this.discordService = new DiscordService(this.events, clientId);
    this.providerService = new ProviderService(this.events);
    this.ipcService = new IPCService(this.events);
    this.wsServer = new WaveRPCWebSocketServer(this.events);
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
      if (track === undefined && trackedProviderId === 'soundcloud') {
        log.info('SoundCloud track cleared. Deactivating SoundCloud provider.');
        this.providerService.getRegistry().setActiveProvider(null);
        this.events.emit('provider:deactivated', 'soundcloud');
      }
    });

    this.events.on('provider:activated', (providerId) => {
      trackedProviderId = providerId;
    });

    this.events.on('provider:deactivated', () => {
      trackedProviderId = undefined;
    });

    this.events.on('extension:disconnected', () => {
      if (!this.wsServer.hasConnectedClients()) {
        if (activeTrack !== undefined) {
          log.info('Final extension client disconnected. Clearing active track.');
          this.events.emit('track:changed', undefined);
        }

        if (trackedProviderId !== undefined) {
          log.info(
            `Final extension client disconnected. Deactivating provider: ${trackedProviderId}`
          );
          this.providerService.getRegistry().setActiveProvider(null);
          this.events.emit('provider:deactivated', trackedProviderId);
        }
      }
    });
  }

  public async shutdown(): Promise<void> {
    log.info('Shutting down WaveRPC Desktop...');
    await this.wsServer.stop();
    await this.discordService.disconnect();
    this.events.removeAllListeners();
    log.info('Shutdown complete.');
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
