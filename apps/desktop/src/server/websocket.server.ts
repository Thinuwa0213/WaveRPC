import { WebSocketServer, WebSocket } from 'ws';
import { TypedEventEmitter, Logger } from '@waverpc/shared';
import { ExtensionMessageHandler } from './message.handler.js';
import { ServerOptions } from './types.js';

const log = new Logger('WebSocketServer');

export class WaveRPCWebSocketServer {
  private wss: WebSocketServer | null = null;
  private messageHandler: ExtensionMessageHandler;
  private port: number;
  private host: string;

  constructor(events: TypedEventEmitter, options?: ServerOptions) {
    this.port = options?.port ?? 6124;
    this.host = options?.host ?? '127.0.0.1';
    this.messageHandler = new ExtensionMessageHandler(events);
  }

  public async start(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
        });

        this.wss.on('listening', () => {
          log.info(`Listening on ws://${this.host}:${this.port}`);
          resolve(true);
        });

        this.wss.on('connection', (ws: WebSocket) => {
          log.info('Extension client connected.');

          ws.on('message', (data: Buffer | string) => {
            const raw = data.toString();
            this.messageHandler.handleMessage(raw);
          });

          ws.on('close', () => {
            log.info('Extension client disconnected.');
          });

          ws.on('error', (err: Error) => {
            log.error('Client socket error:', err.message);
          });
        });

        this.wss.on('error', (err: Error) => {
          log.error('Server error:', err.message);
          resolve(false);
        });
      } catch (error) {
        log.error('Failed to initialize WebSocket server:', error);
        resolve(false);
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.wss) return;

    return new Promise((resolve) => {
      this.wss?.close(() => {
        log.info('Server stopped.');
        this.wss = null;
        resolve();
      });
    });
  }

  public get isRunning(): boolean {
    return this.wss !== null;
  }
}
