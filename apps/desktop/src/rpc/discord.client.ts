import * as net from 'net';
import { Logger } from '@waverpc/shared';

const log = new Logger('DiscordRPC');

/** Maximum number of Discord IPC pipe endpoints to scan (0–9). */
const MAX_IPC_PIPE_ID = 9;

export type RPCConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'HANDSHAKING' | 'READY';

export interface DiscordRPCClientOptions {
  clientId: string;
  autoReconnect?: boolean;
  maxReconnectIntervalMs?: number;
  onStateChange?: (state: RPCConnectionState) => void;
}

export class DiscordRPCClient {
  private socket: net.Socket | null = null;
  private state: RPCConnectionState = 'DISCONNECTED';
  private clientId: string;
  private autoReconnect: boolean;
  private maxReconnectIntervalMs: number;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pid: number;
  private onStateChange?: (state: RPCConnectionState) => void;
  private buffer: Buffer = Buffer.alloc(0);
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: boolean) => void;
      timer: NodeJS.Timeout;
      cmd: string;
      generation: number;
    }
  >();
  private connectionGeneration = 0;
  private connectingSocket: net.Socket | null = null;

  constructor(options: DiscordRPCClientOptions) {
    this.clientId = options.clientId;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectIntervalMs = options.maxReconnectIntervalMs ?? 30000;
    this.onStateChange = options.onStateChange;
    this.pid = process.pid;
  }

  private setState(state: RPCConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }

  public get ConnectionState(): RPCConnectionState {
    return this.state;
  }

  private isPlaceholderOrInvalidClientId(clientId?: string): boolean {
    if (!clientId) return true;
    const trimmed = clientId.trim();
    if (trimmed === '' || trimmed === '123456789012345678') return true;
    if (!/^\d+$/.test(trimmed)) return true;
    return false;
  }

  public async connect(): Promise<boolean> {
    if (this.state === 'READY' || this.state === 'CONNECTING' || this.state === 'HANDSHAKING') {
      return this.state === 'READY';
    }

    if (this.isPlaceholderOrInvalidClientId(this.clientId)) {
      log.warn(
        `Discord Client ID configuration is missing, placeholder, or invalid (${this.clientId}). Skipping Discord RPC connection scan to prevent aggressive connection loops.`
      );
      this.setState('DISCONNECTED');
      return false;
    }

    this.setState('CONNECTING');
    log.info(`Connecting to Discord IPC (Client ID: ${this.clientId})...`);

    const generation = ++this.connectionGeneration;

    for (let pipeId = 0; pipeId <= MAX_IPC_PIPE_ID; pipeId++) {
      if (generation !== this.connectionGeneration) {
        this.setState('DISCONNECTED');
        return false;
      }
      const connected = await this.tryPipe(pipeId, generation);
      if (connected) {
        return true;
      }
    }

    log.warn('All Discord IPC pipes (0–9) unavailable.');
    this.setState('DISCONNECTED');

    if (this.autoReconnect && generation === this.connectionGeneration) {
      this.scheduleReconnect();
    }

    return false;
  }

  public async disconnect(): Promise<void> {
    this.autoReconnect = false;
    this.connectionGeneration++;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.cleanupSocket();
    this.setState('DISCONNECTED');
    this.reconnectAttempts = 0;
    log.info('Disconnected cleanly.');
  }

  public async setActivity(activity: unknown): Promise<boolean> {
    if (this.state !== 'READY' || !this.socket) {
      log.warn('Cannot set activity: RPC Client is not ready.');
      return false;
    }

    const nonce = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const generation = this.connectionGeneration;

    return new Promise<boolean>((resolve) => {
      const payload = {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: this.pid,
          activity,
        },
        nonce,
      };

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(nonce)) {
          this.pendingRequests.delete(nonce);
          log.warn('Discord IPC command timed out.');
          resolve(false);
        }
      }, 5000);

      this.pendingRequests.set(nonce, { resolve, timer, cmd: 'SET_ACTIVITY', generation });

      const sent = this.sendPacket(1, payload);
      if (!sent) {
        clearTimeout(timer);
        this.pendingRequests.delete(nonce);
        resolve(false);
      }
    });
  }

  public async clearActivity(): Promise<boolean> {
    log.info('Clearing Discord activity...');
    if (this.state !== 'READY') {
      log.warn('Cannot clear activity: RPC Client is not ready.');
      return false;
    }
    const success = await this.setActivity(null);
    if (success) {
      log.info('Discord activity cleared.');
      return true;
    } else {
      log.warn('Failed to clear Discord activity.');
      return false;
    }
  }

  private tryPipe(pipeId: number, generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (generation !== this.connectionGeneration) {
        resolve(false);
        return;
      }
      const pipePath = this.getIPCPath(pipeId);
      log.debug(`Trying IPC pipe ${pipeId}: ${pipePath}`);

      let settled = false;
      const socket = net.createConnection(pipePath);
      this.connectingSocket = socket;

      socket.once('connect', () => {
        if (this.connectingSocket === socket) {
          this.connectingSocket = null;
        }
        if (settled) return;
        settled = true;

        if (generation !== this.connectionGeneration) {
          log.info(
            `Connected to pipe ${pipeId} after disconnect/generation mismatch. Destroying socket.`
          );
          socket.destroy();
          resolve(false);
          return;
        }

        log.info(`Connected to Discord IPC pipe ${pipeId}. Sending HANDSHAKE...`);
        this.socket = socket;
        this.setState('HANDSHAKING');
        this.sendHandshake();

        if (this.reconnectAttempts > 0) {
          log.info(
            `Connection restored after ${this.reconnectAttempts} reconnect attempt(s). Backoff reset.`
          );
        }
        this.reconnectAttempts = 0;

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        this.setupSocketListeners(socket, generation);
        resolve(true);
      });

      socket.once('error', (err: Error) => {
        if (this.connectingSocket === socket) {
          this.connectingSocket = null;
        }
        if (settled) return;
        settled = true;
        log.debug(`Pipe ${pipeId} unavailable: ${err.message}`);
        socket.destroy();
        resolve(false);
      });

      socket.once('close', () => {
        if (this.connectingSocket === socket) {
          this.connectingSocket = null;
        }
        if (settled) return;
        settled = true;
        resolve(false);
      });
    });
  }

  private sendHandshake(): void {
    const payload = {
      v: 1,
      client_id: this.clientId,
    };
    this.sendPacket(0, payload);
  }

  private sendPacket(opcode: number, payload: unknown): boolean {
    if (!this.socket || this.socket.destroyed) return false;

    try {
      const json = JSON.stringify(payload);
      const dataBuffer = Buffer.from(json, 'utf-8');
      const headerBuffer = Buffer.alloc(8);

      headerBuffer.writeInt32LE(opcode, 0);
      headerBuffer.writeInt32LE(dataBuffer.length, 4);

      const packet = Buffer.concat([headerBuffer, dataBuffer]);
      return this.socket.write(packet);
    } catch (error) {
      log.error('Failed to send packet:', error);
      return false;
    }
  }

  private setupSocketListeners(socket: net.Socket, generation: number): void {
    socket.on('data', (data: Buffer) => {
      if (generation !== this.connectionGeneration) return;
      this.handleSocketData(data, generation);
    });

    socket.on('close', () => {
      if (generation !== this.connectionGeneration) return;
      log.info('Discord IPC socket closed.');
      this.handleDisconnect();
    });

    socket.on('error', (err: Error) => {
      if (generation !== this.connectionGeneration) return;
      log.error('Socket error:', err.message);
    });
  }

  private handleSocketData(data: Buffer, generation: number): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    const MAX_PAYLOAD_LENGTH = 10 * 1024 * 1024; // 10MB conservative limit

    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);

      if (length < 0 || length > MAX_PAYLOAD_LENGTH) {
        log.warn(`Invalid Discord IPC frame length: ${length}. Discarding buffer.`);
        this.buffer = Buffer.alloc(0);
        break;
      }

      if (this.buffer.length < 8 + length) {
        // Partial frame, wait for more data
        break;
      }

      const payloadBuffer = this.buffer.subarray(8, 8 + length);
      // Consume frame from buffer
      this.buffer = this.buffer.subarray(8 + length);

      try {
        const payload = JSON.parse(payloadBuffer.toString('utf-8'));
        const cmd = typeof payload.cmd === 'string' ? payload.cmd : undefined;
        const evt = typeof payload.evt === 'string' ? payload.evt : undefined;
        const nonce = typeof payload.nonce === 'string' ? payload.nonce : undefined;

        if (cmd || evt) {
          log.debug(
            `Discord response: opcode=${opcode}${cmd ? ` cmd=${cmd}` : ''}${evt ? ` evt=${evt}` : ''}`
          );
        }

        if (cmd === 'DISPATCH' && evt === 'READY') {
          if (generation === this.connectionGeneration) {
            log.info('Discord READY received.');
            this.setState('READY');
          } else {
            log.warn('Stale READY from old generation ignored.');
          }
        }

        if (nonce && this.pendingRequests.has(nonce)) {
          const req = this.pendingRequests.get(nonce)!;

          if (cmd === req.cmd && req.generation === generation) {
            clearTimeout(req.timer);
            this.pendingRequests.delete(nonce);

            if (evt === 'ERROR') {
              req.resolve(false);
            } else {
              req.resolve(true);
            }
          }
        }
      } catch (err: any) {
        log.warn('Failed to parse Discord IPC response frame:', err.message);
      }
    }
  }

  private handleDisconnect(): void {
    this.cleanupSocket();
    this.setState('DISCONNECTED');

    if (this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.autoReconnect || this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectIntervalMs
    );
    log.info(`Reconnect attempt #${this.reconnectAttempts} scheduled in ${delay}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err: Error) => {
        log.error('Reconnect attempt failed:', err.message);
      });
    }, delay);
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    if (this.connectingSocket) {
      this.connectingSocket.destroy();
      this.connectingSocket = null;
    }
    this.buffer = Buffer.alloc(0);

    for (const req of this.pendingRequests.values()) {
      clearTimeout(req.timer);
      req.resolve(false);
    }
    this.pendingRequests.clear();
  }

  private getIPCPath(id: number): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\discord-ipc-${id}`;
    }

    const { env } = process;
    const prefix = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
    return `${prefix.replace(/\/$/, '')}/discord-ipc-${id}`;
  }
}
