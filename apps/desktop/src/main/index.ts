import { TypedEventEmitter } from '@waverpc/shared';
import { DiscordService } from '../services/discord.service.js';
import { ProviderService } from '../services/provider.service.js';
import { IPCService } from '../services/ipc.service.js';

export class WaveRPCDesktopApp {
  private events: TypedEventEmitter;
  private discordService: DiscordService;
  private providerService: ProviderService;
  private ipcService: IPCService;

  constructor() {
    const clientId = process.env.DISCORD_CLIENT_ID || '123456789012345678';
    this.events = new TypedEventEmitter();
    this.discordService = new DiscordService(this.events, clientId);
    this.providerService = new ProviderService(this.events);
    this.ipcService = new IPCService(this.events);
  }

  public async bootstrap(): Promise<void> {
    console.log('[WaveRPCDesktopApp] Initializing WaveRPC Desktop App (Phase 1)...');
    this.ipcService.initialize();

    await this.discordService.connect();

    const activeProviderId = await this.providerService.detectActiveProvider('https://mockmusic.local/track/synthwave-dreams');
    console.log(`[WaveRPCDesktopApp] Active Provider: ${activeProviderId}`);

    const mockProvider = this.providerService.getRegistry().getProvider('mock');
    if (mockProvider) {
      const track = await mockProvider.getCurrentTrack();
      this.providerService.setTrack(track);
    }

    console.log('[WaveRPCDesktopApp] Bootstrap complete.');
  }

  public async shutdown(): Promise<void> {
    await this.discordService.disconnect();
    this.events.removeAllListeners();
  }
}

const app = new WaveRPCDesktopApp();
app.bootstrap().catch((err) => {
  console.error('Failed to bootstrap WaveRPC Desktop:', err);
});
