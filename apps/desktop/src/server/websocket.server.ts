import { WebSocketServer, WebSocket } from 'ws';
import { TypedEventEmitter, Logger, withTimeout } from '@waverpc/shared';
import { ExtensionMessageHandler } from './message.handler.js';
import { ServerOptions } from './types.js';

const log = new Logger('WebSocketServer');

export class WaveRPCWebSocketServer {
  private wss: WebSocketServer | null = null;
  private messageHandler: ExtensionMessageHandler;
  private port: number;
  private host: string;
  private clients = new Set<WebSocket>();
  private isStopping = false;

  constructor(
    private events: TypedEventEmitter,
    options?: ServerOptions
  ) {
    this.port = options?.port ?? 6124;
    this.host = options?.host ?? '127.0.0.1';
    this.messageHandler = new ExtensionMessageHandler(events);
  }

  public async start(): Promise<boolean> {
    this.isStopping = false;
    return new Promise((resolve, reject) => {
      let isListening = false;
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
        });

        this.wss.on('listening', () => {
          isListening = true;
          log.info(`Listening on ws://${this.host}:${this.port}`);
          resolve(true);
        });

        this.wss.on('connection', (ws: WebSocket) => {
          if (this.isStopping) {
            log.warn('Server is stopping. Rejecting new extension connection.');
            try {
              ws.removeAllListeners();
              ws.terminate();
            } catch {}
            return;
          }

          log.info('Extension client connected.');
          this.clients.add(ws);
          if (this.clients.size === 1) {
            this.events.emit('extension:connected');
          }

          ws.on('message', (data: any) => {
            if (this.isStopping) return;
            try {
              let len = 0;
              if (Buffer.isBuffer(data)) {
                len = data.length;
              } else if (data instanceof ArrayBuffer) {
                len = data.byteLength;
              } else if (Array.isArray(data)) {
                for (const chunk of data) {
                  if (Buffer.isBuffer(chunk)) {
                    len += chunk.length;
                  } else if (chunk instanceof ArrayBuffer) {
                    len += chunk.byteLength;
                  }
                }
              } else if (typeof data === 'string') {
                len = Buffer.byteLength(data);
              }

              if (len > 102400) {
                log.warn(`Rejected oversized WebSocket message (${len} bytes)`);
                return;
              }

              const raw = Buffer.isBuffer(data)
                ? data.toString()
                : Array.isArray(data)
                  ? Buffer.concat(
                      data.map((item) => (Buffer.isBuffer(item) ? item : Buffer.from(item)))
                    ).toString()
                  : data instanceof ArrayBuffer
                    ? Buffer.from(data).toString()
                    : String(data);

              this.messageHandler.handleMessage(raw);
            } catch (err: any) {
              log.error('Error handling WebSocket message:', err.message || err);
            }
          });

          ws.on('close', () => {
            log.info('Extension client disconnected.');
            this.clients.delete(ws);
            if (this.clients.size === 0 && !this.isStopping) {
              this.events.emit('extension:disconnected');
            }
          });

          ws.on('error', (err: Error) => {
            log.error('Client socket error:', err.message);
          });
        });

        this.wss.on('error', (err: any) => {
          if (this.wss && !isListening) {
            try {
              this.wss.removeAllListeners();
              this.wss.close();
            } catch {}
            this.wss = null;
            reject(err);
          } else {
            log.error('Server error:', err.message || err);
          }
        });
      } catch (error) {
        log.error('Failed to initialize WebSocket server:', error);
        reject(error);
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.wss || this.isStopping) return;
    this.isStopping = true;
    log.info('Stopping WebSocket server...');

    // 1. Terminate all active clients and clear client set
    for (const ws of this.clients) {
      try {
        ws.removeAllListeners();
        ws.terminate();
      } catch (err) {
        log.error('Error terminating client socket:', err);
      }
    }
    this.clients.clear();

    // 2. Close wss with bounded timeout
    const closePromise = new Promise<void>((resolve) => {
      const server = this.wss;
      if (!server) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });

    await withTimeout(closePromise, 2000, undefined, 'WebSocketServer.stop', log);

    if (this.wss) {
      try {
        this.wss.removeAllListeners();
      } catch {}
      this.wss = null;
    }
    log.info('WebSocket server stopped.');
  }

  public broadcast(message: unknown): void {
    if (!this.wss || this.isStopping) return;
    const json = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(json);
        } catch (err) {
          log.error('Failed to send broadcast message:', err);
        }
      }
    }
  }

  public get isRunning(): boolean {
    return this.wss !== null && !this.isStopping;
  }

  public hasConnectedClients(): boolean {
    return this.clients.size > 0;
  }

  public getIsStopping(): boolean {
    return this.isStopping;
  }
}
