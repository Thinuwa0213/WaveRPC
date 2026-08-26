import * as net from 'net';
import { Logger } from '@waverpc/shared';

const log = new Logger('DiscordRPC');

/** Maximum number of Discord IPC pipe endpoints to scan (0–9). */
const MAX_IPC_PIPE_ID = 9;

export type RPCConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface DiscordRPCClientOptions {
  clientId: string;
  autoReconnect?: boolean;
  maxReconnectIntervalMs?: number;
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

  constructor(options: DiscordRPCClientOptions) {
    this.clientId = options.clientId;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectIntervalMs = options.maxReconnectIntervalMs ?? 30000;
    this.pid = process.pid;
  }

  public get ConnectionState(): RPCConnectionState {
    return this.state;
  }

  public async connect(): Promise<boolean> {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') {
      return this.state === 'CONNECTED';
    }

    this.state = 'CONNECTING';
    log.info(`Connecting to Discord IPC (Client ID: ${this.clientId})...`);

    for (let pipeId = 0; pipeId <= MAX_IPC_PIPE_ID; pipeId++) {
      const connected = await this.tryPipe(pipeId);
      if (connected) {
        return true;
      }
    }

    log.warn('All Discord IPC pipes (0–9) unavailable.');
    this.state = 'DISCONNECTED';

    if (this.autoReconnect) {
      this.scheduleReconnect();
    }

    return false;
  }

  public async disconnect(): Promise<void> {
    this.autoReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.cleanupSocket();
    this.state = 'DISCONNECTED';
    this.reconnectAttempts = 0;
    log.info('Disconnected cleanly.');
  }

  public async setActivity(activity: unknown): Promise<boolean> {
    if (this.state !== 'CONNECTED' || !this.socket) {
      log.warn('Cannot set activity: RPC Client is not connected.');
      return false;
    }

    const payload = {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: this.pid,
        activity,
      },
      nonce: Date.now().toString(),
    };

    return this.sendPacket(1, payload);
  }

  public async clearActivity(): Promise<boolean> {
    return this.setActivity(null);
  }

  private tryPipe(pipeId: number): Promise<boolean> {
    return new Promise((resolve) => {
      const pipePath = this.getIPCPath(pipeId);
      log.debug(`Trying IPC pipe ${pipeId}: ${pipePath}`);

      let settled = false;
      const socket = net.createConnection(pipePath);

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        log.info(`Connected to Discord IPC pipe ${pipeId}. Sending HANDSHAKE...`);
        this.socket = socket;
        this.sendHandshake();
        this.state = 'CONNECTED';

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

        this.setupSocketListeners();
        resolve(true);
      });

      socket.once('error', (err: Error) => {
        if (settled) return;
        settled = true;
        log.debug(`Pipe ${pipeId} unavailable: ${err.message}`);
        socket.destroy();
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

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on('data', (data: Buffer) => {
      this.handleSocketData(data);
    });

    this.socket.on('close', () => {
      log.info('Discord IPC socket closed.');
      this.handleDisconnect();
    });

    this.socket.on('error', (err: Error) => {
      log.error('Socket error:', err.message);
    });
  }

  private handleSocketData(data: Buffer): void {
    try {
      if (data.length < 8) {
        log.warn('Received malformed Discord IPC frame (too short).');
        return;
      }

      const opcode = data.readInt32LE(0);
      const length = data.readInt32LE(4);

      if (data.length < 8 + length) {
        log.warn(
          `Received partial Discord IPC frame (expected ${8 + length} bytes, got ${data.length}).`
        );
        return;
      }

      const payloadBuffer = data.subarray(8, 8 + length);
      const payload = JSON.parse(payloadBuffer.toString('utf-8'));

      const cmd = typeof payload.cmd === 'string' ? payload.cmd : undefined;
      const evt = typeof payload.evt === 'string' ? payload.evt : undefined;

      if (cmd || evt) {
        log.debug(
          `Discord response: opcode=${opcode}${cmd ? ` cmd=${cmd}` : ''}${evt ? ` evt=${evt}` : ''}`
        );
      }
    } catch {
      log.warn('Failed to parse Discord IPC response frame.');
    }
  }

  private handleDisconnect(): void {
    this.cleanupSocket();
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
