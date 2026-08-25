import { TypedEventEmitter } from '@waverpc/shared';

export class IPCService {
  constructor(private events: TypedEventEmitter) {}

  public initialize(): void {
    console.log('[IPCService] Initialized IPC event handlers');
    this.events.on('provider:activated', (providerId) => {
      console.log(`[IPCService] Forwarding provider activation over IPC: ${providerId}`);
    });
  }

  public handleProviderMessage(channel: string, payload: unknown): void {
    console.log(`[IPCService] Channel: ${channel}, Payload:`, payload);
  }
}
