import {
  ExtensionOutboundMessage,
  ExtensionTrackPayload,
  ExtensionPlaybackPayload,
} from './messages.js';
import { Logger } from '@waverpc/shared';

const log = new Logger('ExtensionWS');

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface ExtensionWSClientOptions {
  url?: string;
  autoReconnect?: boolean;
  maxReconnectIntervalMs?: number;
}

export class ExtensionWSClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private url: string;
  private autoReconnect: boolean;
  private maxReconnectIntervalMs: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;

  constructor(options?: ExtensionWSClientOptions) {
    this.url = options?.url ?? 'ws://127.0.0.1:6124';
    this.autoReconnect = options?.autoReconnect ?? true;
    this.maxReconnectIntervalMs = options?.maxReconnectIntervalMs ?? 30000;
  }

  public get connectionState(): ConnectionState {
    return this.state;
  }

  public connect(): void {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') return;

    this.state = 'CONNECTING';
    log.info(`Connecting to ${this.url}...`);

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        log.info('Connected to Desktop Bridge.');
        this.state = 'CONNECTED';

        if (this.reconnectAttempts > 0) {
          log.info(
            `Reconnected successfully after ${this.reconnectAttempts} attempt(s). Backoff reset.`
          );
        }
        this.reconnectAttempts = 0;

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.socket.onclose = () => {
        log.info('Disconnected from Desktop Bridge.');
        this.handleDisconnect();
      };

      this.socket.onerror = (error) => {
        log.warn('Socket error:', error);
      };
    } catch (error) {
      log.error('Failed to create WebSocket connection:', error);
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
    this.reconnectAttempts = 0;
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

  public sendTrackClear(): boolean {
    return this.send({
      type: 'TRACK_CLEAR',
    });
  }

  private send(message: ExtensionOutboundMessage): boolean {
    if (this.state !== 'CONNECTED' || !this.socket) {
      log.warn('Send failed: client is not connected.');
      return false;
    }

    try {
      const json = JSON.stringify(message);
      this.socket.send(json);
      return true;
    } catch (error) {
      log.error('Failed to send message:', error);
      return false;
    }
  }

  private handleDisconnect(): void {
    this.socket = null;
    this.state = 'DISCONNECTED';

    if (this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectIntervalMs
    );

    log.info(`Reconnect attempt #${this.reconnectAttempts} scheduled in ${delay}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
