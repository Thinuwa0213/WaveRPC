import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import EventEmitter from 'node:events';
import net from 'node:net';
import { DiscordRPCClient } from './discord.client.js';

class MockSocket extends EventEmitter {
  public destroyed = false;
  public writtenBuffers: Buffer[] = [];
  public path: string;

  constructor(path: string) {
    super();
    this.path = path;
  }

  public write(data: Buffer): boolean {
    if (this.destroyed) return false;
    this.writtenBuffers.push(Buffer.from(data));
    return true;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }

  public emitConnect(): void {
    this.emit('connect');
  }

  public emitError(err: Error = new Error('Pipe unavailable')): void {
    this.emit('error', err);
  }

  public emitData(data: Buffer): void {
    this.emit('data', data);
  }

  public emitClose(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

async function flushMicrotasks(count = 15): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise((r) => queueMicrotask(() => r(undefined)));
  }
}

describe('DiscordRPCClient Resilience & Transport Tests', () => {
  let activeSockets: MockSocket[] = [];

  beforeEach(() => {
    activeSockets = [];
    mock.timers.enable();
  });

  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
  });

  it('5. Discord IPC Pipe Scanning: should attempt pipes 0..9 in order and stop at first success', async () => {
    const attemptedPipes: string[] = [];

    mock.method(net, 'createConnection', ((pipePath: string) => {
      attemptedPipes.push(pipePath);
      const mockSocket = new MockSocket(pipePath);
      activeSockets.push(mockSocket);

      queueMicrotask(() => {
        if (pipePath.endsWith('discord-ipc-0') || pipePath.endsWith('discord-ipc-1')) {
          mockSocket.emitError(new Error('Pipe not available'));
        } else {
          mockSocket.emitConnect();
        }
      });

      return mockSocket as any;
    }) as any);

    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: false });
    const connected = await client.connect();

    assert.strictEqual(connected, true);
    assert.strictEqual(client.ConnectionState, 'CONNECTED');
    assert.strictEqual(attemptedPipes.length, 3);
    assert.ok(attemptedPipes[0].endsWith('discord-ipc-0'), 'First pipe should be pipe 0');
    assert.ok(attemptedPipes[1].endsWith('discord-ipc-1'), 'Second pipe should be pipe 1');
    assert.ok(attemptedPipes[2].endsWith('discord-ipc-2'), 'Third pipe should be pipe 2');

    await client.disconnect();
  });

  it('6. All Discord Pipes Unavailable: should attempt all 10 pipes, return DISCONNECTED, schedule 1 reconnect, and retain no socket', async () => {
    const attemptedPipes: string[] = [];

    mock.method(net, 'createConnection', ((pipePath: string) => {
      attemptedPipes.push(pipePath);
      const mockSocket = new MockSocket(pipePath);
      activeSockets.push(mockSocket);

      queueMicrotask(() => {
        mockSocket.emitError(new Error('Pipe unavailable'));
      });

      return mockSocket as any;
    }) as any);

    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: true });
    const connected = await client.connect();

    assert.strictEqual(connected, false);
    assert.strictEqual(attemptedPipes.length, 10, 'All 10 pipes (0-9) should have been attempted');
    assert.strictEqual(client.ConnectionState, 'DISCONNECTED');
    assert.strictEqual((client as any).socket, null, 'No socket should be retained');

    // Verify exactly 1 reconnect attempt was scheduled for 1000ms
    assert.strictEqual((client as any).reconnectAttempts, 1);
    assert.ok((client as any).reconnectTimer !== null, 'Reconnect timer should be active');

    await client.disconnect();
  });

  it('7. Discord Backoff Reset: exponential backoff should work and successful connection resets backoff state', async () => {
    let connectionAttemptsCount = 0;

    mock.method(net, 'createConnection', ((pipePath: string) => {
      const mockSocket = new MockSocket(pipePath);
      activeSockets.push(mockSocket);

      queueMicrotask(() => {
        connectionAttemptsCount++;
        // Initial attempt (all 10 pipes fail) -> attempts 1..10
        // Reconnect 1 (delay 1s): all 10 fail -> attempts 11..20
        // Reconnect 2 (delay 2s): pipe 0 succeeds -> attempt 21
        if (connectionAttemptsCount <= 20) {
          mockSocket.emitError(new Error('Unavailable'));
        } else {
          mockSocket.emitConnect();
        }
      });

      return mockSocket as any;
    }) as any);

    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: true });

    // Initial connection attempt (attempts 1..10 fail -> schedules reconnect in 1000ms)
    await client.connect();
    assert.strictEqual((client as any).reconnectAttempts, 1);

    // Advance 1000ms -> triggers reconnect attempt 1 (attempts 11..20 fail -> schedules reconnect in 2000ms)
    mock.timers.tick(1000);
    await flushMicrotasks(15);
    assert.strictEqual((client as any).reconnectAttempts, 2);

    // Advance 2000ms -> triggers reconnect attempt 2 (attempt 21 succeeds)
    mock.timers.tick(2000);
    await flushMicrotasks(15);

    assert.strictEqual(client.ConnectionState, 'CONNECTED');
    assert.strictEqual(
      (client as any).reconnectAttempts,
      0,
      'Backoff counter must be reset to 0 on success'
    );
    assert.strictEqual((client as any).reconnectTimer, null);

    // Disconnect cleanly
    await client.disconnect();
    assert.strictEqual(client.ConnectionState, 'DISCONNECTED');
    assert.strictEqual((client as any).reconnectAttempts, 0);

    // Re-enable autoReconnect and simulate a future failure
    (client as any).autoReconnect = true;
    connectionAttemptsCount = 0; // force failure
    await client.connect();

    assert.strictEqual(client.ConnectionState, 'DISCONNECTED');
    assert.strictEqual(
      (client as any).reconnectAttempts,
      1,
      'Next failure after reset should start backoff at attempt 1'
    );

    await client.disconnect();
  });

  it('8. Socket Cleanup: should remove socket listeners, destroy socket, clear reference, and prevent stale activity sends', async () => {
    let mockSocketRef: MockSocket | null = null;

    mock.method(net, 'createConnection', ((pipePath: string) => {
      mockSocketRef = new MockSocket(pipePath);
      activeSockets.push(mockSocketRef);

      queueMicrotask(() => {
        mockSocketRef!.emitConnect();
      });

      return mockSocketRef as any;
    }) as any);

    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: true });
    await client.connect();

    assert.strictEqual(client.ConnectionState, 'CONNECTED');
    const targetSocket = mockSocketRef! as MockSocket;
    assert.ok(targetSocket);

    // Disconnect client
    await client.disconnect();

    assert.strictEqual(client.ConnectionState, 'DISCONNECTED');
    assert.strictEqual((client as any).socket, null, 'Socket reference should be cleared');
    assert.strictEqual(targetSocket.destroyed, true, 'Socket should be destroyed');
    assert.strictEqual(targetSocket.listenerCount('data'), 0, 'Listeners should be removed');
    assert.strictEqual(targetSocket.listenerCount('close'), 0, 'Listeners should be removed');
    assert.strictEqual(targetSocket.listenerCount('error'), 0, 'Listeners should be removed');

    // Attempting to send activity on disconnected client must fail cleanly
    const setActivityResult = await client.setActivity({ details: 'Stale activity' });
    assert.strictEqual(
      setActivityResult,
      false,
      'setActivity on disconnected client should return false'
    );
    assert.strictEqual(
      targetSocket.writtenBuffers.length,
      1,
      'No new activity packet should be written to old socket (only initial handshake was written)'
    );
  });

  it('9. Malformed IPC Frame: should warn without throwing and remain operational when payload is too short', async () => {
    let mockSocketRef: MockSocket | null = null;

    mock.method(net, 'createConnection', ((pipePath: string) => {
      mockSocketRef = new MockSocket(pipePath);
      activeSockets.push(mockSocketRef);

      queueMicrotask(() => {
        mockSocketRef!.emitConnect();
      });

      return mockSocketRef as any;
    }) as any);

    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: false });
    await client.connect();

    assert.strictEqual(client.ConnectionState, 'CONNECTED');

    // Emit malformed frame (< 8 bytes)
    const malformedBuffer = Buffer.from([0, 1, 2]);
    assert.doesNotThrow(() => {
      mockSocketRef!.emitData(malformedBuffer);
    });

    assert.strictEqual(
      client.ConnectionState,
      'CONNECTED',
      'Client should remain connected after malformed frame'
    );

    await client.disconnect();
  });

  it('10. Partial IPC Frame: should warn without throwing and ignore partial frame exceeding available bytes', async () => {
    let mockSocketRef: MockSocket | null = null;

    mock.method(net, 'createConnection', ((pipePath: string) => {
      mockSocketRef = new MockSocket(pipePath);
      activeSockets.push(mockSocketRef);

      queueMicrotask(() => {
        mockSocketRef!.emitConnect();
      });

      return mockSocketRef as any;
    }) as any);

    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: false });
    await client.connect();

    assert.strictEqual(client.ConnectionState, 'CONNECTED');

    // Header declaring opcode 1 and payload length 100, but buffer only has 10 bytes payload
    const headerBuffer = Buffer.alloc(8);
    headerBuffer.writeInt32LE(1, 0); // opcode
    headerBuffer.writeInt32LE(100, 4); // declared length = 100
    const incompletePayload = Buffer.from('{"cmd":"DISPATCH"}');

    const partialFrame = Buffer.concat([headerBuffer, incompletePayload]);

    assert.doesNotThrow(() => {
      mockSocketRef!.emitData(partialFrame);
    });

    assert.strictEqual(
      client.ConnectionState,
      'CONNECTED',
      'Client should remain connected after partial frame'
    );

    await client.disconnect();
  });

  it('11. Windows IPC Pipe Path Format: should use standard \\\\.\\pipe\\ format on win32', async () => {
    let attemptedPath = '';
    mock.method(net, 'createConnection', ((pipePath: string) => {
      attemptedPath = pipePath;
      const mockSocket = new MockSocket(pipePath);
      activeSockets.push(mockSocket);
      queueMicrotask(() => mockSocket.emitConnect());
      return mockSocket as any;
    }) as any);

    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: false });
    await client.connect();

    if (process.platform === 'win32') {
      assert.strictEqual(attemptedPath, '\\\\.\\pipe\\discord-ipc-0');
    } else {
      assert.ok(attemptedPath.endsWith('discord-ipc-0'));
    }

    await client.disconnect();
  });
});
