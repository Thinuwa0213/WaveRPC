import { TypedEventEmitter } from '@waverpc/shared';
import { PresenceManager } from '../presence/presence.manager.js';
import { DiscordActivityPayload } from '../presence/types.js';

export class DiscordService {
  private presenceManager: PresenceManager;

  constructor(events: TypedEventEmitter, clientId?: string) {
    const finalClientId = clientId || process.env.DISCORD_CLIENT_ID || '123456789012345678';
    this.presenceManager = new PresenceManager(events, {
      clientId: finalClientId,
    });
  }

  public async connect(): Promise<boolean> {
    return this.presenceManager.initialize();
  }

  public async disconnect(): Promise<void> {
    await this.presenceManager.shutdown();
  }

  public getPresence(): DiscordActivityPayload | undefined {
    return this.presenceManager.getActiveActivity();
  }

  public isConnected(): boolean {
    return this.presenceManager.isConnected();
  }
}
