import { TypedEventEmitter, Logger } from '@waverpc/shared';
import { DiscordService } from '../services/discord.service.js';
import { ProviderService } from '../services/provider.service.js';
import { IPCService } from '../services/ipc.service.js';
import { WaveRPCWebSocketServer } from '../server/websocket.server.js';

const pkg = require('../../package.json') as { version: string };

const log = new Logger('WaveRPCDesktop');

export class WaveRPCDesktopApp {
  private events: TypedEventEmitter;
  private discordService: DiscordService;
  private providerService: ProviderService;
  private ipcService: IPCService;
  private wsServer: WaveRPCWebSocketServer;

  constructor() {
    const clientId = process.env.DISCORD_CLIENT_ID || '123456789012345678';
    this.events = new TypedEventEmitter();
    this.discordService = new DiscordService(this.events, clientId);
    this.providerService = new ProviderService(this.events);
    this.ipcService = new IPCService(this.events);
    this.wsServer = new WaveRPCWebSocketServer(this.events);
  }

  public async bootstrap(): Promise<void> {
    log.info(`Starting WaveRPC Desktop v${pkg.version}...`);
    this.ipcService.initialize();

    await this.discordService.connect();
    await this.wsServer.start();

    const activeProviderId = await this.providerService.detectActiveProvider(
      'https://mockmusic.local/track/synthwave-dreams'
    );
    log.info(`Active Provider: ${activeProviderId}`);

    const mockProvider = this.providerService.getRegistry().getProvider('mock');
    if (mockProvider) {
      const track = await mockProvider.getCurrentTrack();
      this.providerService.setTrack(track);
    }

    log.info('Bootstrap complete. Waiting for extension connections...');
  }

  public async shutdown(): Promise<void> {
    log.info('Shutting down WaveRPC Desktop...');
    await this.wsServer.stop();
    await this.discordService.disconnect();
    this.events.removeAllListeners();
    log.info('Shutdown complete.');
  }
}

const app = new WaveRPCDesktopApp();
app.bootstrap().catch((err) => {
  log.error('Failed to bootstrap WaveRPC Desktop:', err);
});
