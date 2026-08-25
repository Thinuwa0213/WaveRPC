import {
  ExtensionOutboundMessage,
  ExtensionTrackPayload,
  ExtensionPlaybackPayload,
} from './messages.js';

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface ExtensionWSClientOptions {
  url?: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
}

export class ExtensionWSClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private url: string;
  private autoReconnect: boolean;
  private reconnectIntervalMs: number;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options?: ExtensionWSClientOptions) {
    this.url = options?.url ?? 'ws://127.0.0.1:6124';
    this.autoReconnect = options?.autoReconnect ?? true;
    this.reconnectIntervalMs = options?.reconnectIntervalMs ?? 5000;
  }

  public get connectionState(): ConnectionState {
    return this.state;
  }

  public connect(): void {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') return;

    this.state = 'CONNECTING';
    console.log(`[ExtensionWSClient] Connecting to ${this.url}...`);

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        console.log('[ExtensionWSClient] WebSocket connection established.');
        this.state = 'CONNECTED';
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.socket.onclose = () => {
        console.log('[ExtensionWSClient] WebSocket connection closed.');
        this.handleDisconnect();
      };

      this.socket.onerror = (error) => {
        console.warn('[ExtensionWSClient] WebSocket error:', error);
      };
    } catch (error) {
      console.error('[ExtensionWSClient] Failed to create WebSocket connection:', error);
      this.handleDisconnect();
    }
  }

  public disconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.state = 'DISCONNECTED';
  }

  public sendTrackUpdate(payload: ExtensionTrackPayload): boolean {
    return this.send({
      type: 'TRACK_UPDATE',
      payload,
    });
  }

  public sendPlaybackUpdate(payload: ExtensionPlaybackPayload): boolean {
    return this.send({
      type: 'PLAYBACK_UPDATE',
      payload,
    });
  }

  private send(message: ExtensionOutboundMessage): boolean {
    if (this.state !== 'CONNECTED' || !this.socket) {
      console.warn('[ExtensionWSClient] Cannot send message: client is not connected.');
      return false;
    }

    try {
      const json = JSON.stringify(message);
      this.socket.send(json);
      return true;
    } catch (error) {
      console.error('[ExtensionWSClient] Failed to send message:', error);
      return false;
    }
  }

  private handleDisconnect(): void {
    this.socket = null;
    this.state = 'DISCONNECTED';

    if (this.autoReconnect && !this.reconnectTimer) {
      console.log(`[ExtensionWSClient] Scheduling reconnect in ${this.reconnectIntervalMs}ms...`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.reconnectIntervalMs);
    }
  }
}
