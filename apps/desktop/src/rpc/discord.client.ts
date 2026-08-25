import * as net from 'net';

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
    console.log(`[DiscordRPCClient] Attempting connection for Client ID: ${this.clientId}`);

    return new Promise((resolve) => {
      const pipePath = this.getIPCPath(0);
      const socket = net.createConnection(pipePath);

      socket.once('connect', () => {
        console.log('[DiscordRPCClient] IPC Pipe connected. Sending HANDSHAKE...');
        this.socket = socket;
        this.sendHandshake();
        this.state = 'CONNECTED';
        this.reconnectAttempts = 0;
        this.setupSocketListeners();
        resolve(true);
      });

      socket.once('error', (err: Error) => {
        console.warn(`[DiscordRPCClient] Connection error on ${pipePath}: ${err.message}`);
        this.handleDisconnect();
        resolve(false);
      });
    });
  }

  public async disconnect(): Promise<void> {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.state = 'DISCONNECTED';
    console.log('[DiscordRPCClient] Disconnected cleanly.');
  }

  public async setActivity(activity: unknown): Promise<boolean> {
    if (this.state !== 'CONNECTED' || !this.socket) {
      console.warn('[DiscordRPCClient] Cannot set activity: RPC Client is not connected.');
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
      this.socket.write(packet);
      return true;
    } catch (error) {
      console.error('[DiscordRPCClient] Failed to send packet:', error);
      return false;
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on('data', (data: Buffer) => {
      this.handleSocketData(data);
    });

    this.socket.on('close', () => {
      console.log('[DiscordRPCClient] Socket closed.');
      this.handleDisconnect();
    });

    this.socket.on('error', (err: Error) => {
      console.error('[DiscordRPCClient] Socket error:', err.message);
    });
  }

  private handleSocketData(_data: Buffer): void {
    // Incoming Discord IPC responses can be handled here
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
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectIntervalMs);
    console.log(`[DiscordRPCClient] Scheduling reconnect attempt #${this.reconnectAttempts} in ${delay}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err: Error) => {
        console.error('[DiscordRPCClient] Reconnect attempt failed:', err.message);
      });
    }, delay);
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
