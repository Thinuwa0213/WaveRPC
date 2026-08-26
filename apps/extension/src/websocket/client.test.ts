import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { ExtensionWSClient } from './client.js';

class MockWebSocket {
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSING = 2;
  public static CLOSED = 3;

  public static instances: MockWebSocket[] = [];

  public url: string;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((error: any) => void) | null = null;
  public sentMessages: string[] = [];
  public closed = false;
  public readyState: number = MockWebSocket.CONNECTING;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  public send(data: string): void {
    this.sentMessages.push(data);
  }

  public close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.closed = true;
    if (this.onclose) {
      this.onclose();
    }
  }

  public triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen();
    }
  }

  public triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.closed = true;
    if (this.onclose) {
      this.onclose();
    }
  }

  public triggerError(err: any = new Error('Socket error')): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onerror) {
      this.onerror(err);
    }
  }
}

describe('ExtensionWSClient Resilience & Reconnect Tests', () => {
  let originalWebSocket: any;

  beforeEach(() => {
    MockWebSocket.instances = [];
    originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = MockWebSocket as any;
    mock.timers.enable();
  });

  afterEach(() => {
    mock.timers.reset();
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it('1. Extension Backoff Sequence: should follow exponential backoff sequence (1s, 2s, 4s, 8s, 16s, 30s, 30s)', () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();

    assert.strictEqual(MockWebSocket.instances.length, 1);
    assert.strictEqual(client.connectionState, 'CONNECTING');

    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

    for (let i = 0; i < expectedDelays.length; i++) {
      const delay = expectedDelays[i];
      const currentSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      // Simulate connection failure / close
      currentSocket.triggerClose();
      assert.strictEqual(client.connectionState, 'DISCONNECTED');

      // Before delay elapses: no new attempt should have been made
      if (delay > 1) {
        mock.timers.tick(delay - 1);
        assert.strictEqual(
          MockWebSocket.instances.length,
          i + 1,
          `At delay - 1ms (${delay - 1}ms), no new WebSocket instance should be created for attempt ${i + 1}`
        );
      }

      // Elapse remaining 1ms
      mock.timers.tick(1);
      assert.strictEqual(
        MockWebSocket.instances.length,
        i + 2,
        `At exact delay (${delay}ms), new WebSocket instance should be created for attempt ${i + 2}`
      );
      assert.strictEqual(client.connectionState, 'CONNECTING');
    }

    client.disconnect();
  });

  it('2. Extension Backoff Reset: should reset attempt counter upon successful connection', () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();

    // Fail 3 attempts (delays would be 1s, 2s, 4s)
    for (let i = 0; i < 3; i++) {
      const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      socket.triggerClose();
      const delay = 1000 * Math.pow(2, i);
      mock.timers.tick(delay);
    }

    assert.strictEqual(MockWebSocket.instances.length, 4);

    // Attempt 4 succeeds!
    const activeSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    activeSocket.triggerOpen();
    assert.strictEqual(client.connectionState, 'CONNECTED');

    // Now disconnect active socket
    activeSocket.triggerClose();
    assert.strictEqual(client.connectionState, 'DISCONNECTED');

    // Verify backoff timer was reset to 1000ms (1s) instead of continuing to 8s
    mock.timers.tick(999);
    assert.strictEqual(
      MockWebSocket.instances.length,
      4,
      'Should not reconnect before 1000ms after reset'
    );

    mock.timers.tick(1);
    assert.strictEqual(
      MockWebSocket.instances.length,
      5,
      'Should reconnect at 1000ms after backoff reset'
    );

    client.disconnect();
  });

  it('3. Duplicate Reconnect Timer Prevention: should schedule only one reconnect timer when error and close occur', () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();

    const socket = MockWebSocket.instances[0];

    // Trigger both error and close
    socket.triggerError(new Error('Network error'));
    socket.triggerClose();

    // Trigger close a second time to simulate double callback
    socket.triggerClose();

    // Advance time to reconnect delay (1000ms)
    mock.timers.tick(1000);

    // Verify only ONE new WebSocket instance was created for attempt #2
    assert.strictEqual(
      MockWebSocket.instances.length,
      2,
      'Only one reconnect attempt should be scheduled'
    );

    client.disconnect();
  });

  it('4. Manual Extension Disconnect: should cancel pending timer, disable autoReconnect, and close socket cleanly', () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();

    const socket = MockWebSocket.instances[0];
    socket.triggerClose(); // Reconnect scheduled for 1000ms

    // Call manual disconnect while timer is pending
    client.disconnect();

    assert.strictEqual(client.connectionState, 'DISCONNECTED');

    // Advance timers well beyond delay
    mock.timers.tick(10000);

    // Verify no new connection attempt was launched
    assert.strictEqual(
      MockWebSocket.instances.length,
      1,
      'No reconnect should occur after manual disconnect'
    );

    // Verify closing socket again does not trigger auto reconnect
    socket.triggerClose();
    mock.timers.tick(10000);
    assert.strictEqual(MockWebSocket.instances.length, 1);
  });

  it('5. Heartbeat Starts on Open: should begin heartbeat only after onopen triggers', () => {
    const client = new ExtensionWSClient();
    client.connect();

    const socket = MockWebSocket.instances[0] as any;

    // Before open: no pings should be sent even after 20s
    mock.timers.tick(20000);
    assert.strictEqual(socket.sentMessages.length, 0);

    // Open connection
    socket.triggerOpen();

    // After open: first ping occurs at 20s
    mock.timers.tick(19999);
    assert.strictEqual(socket.sentMessages.length, 0);

    mock.timers.tick(1);
    assert.strictEqual(socket.sentMessages.length, 1);
    assert.deepStrictEqual(JSON.parse(socket.sentMessages[0]), { type: 'PING' });

    // Repeated pings occur every 20s
    mock.timers.tick(20000);
    assert.strictEqual(socket.sentMessages.length, 2);
    assert.deepStrictEqual(JSON.parse(socket.sentMessages[1]), { type: 'PING' });

    client.disconnect();
  });

  it('6. Heartbeat Lifecycle - Stops on Close and Error: should stop sending pings after close or error', () => {
    const client = new ExtensionWSClient();
    client.connect();

    const socket = MockWebSocket.instances[0] as any;
    socket.triggerOpen();

    // 1st ping at 20s
    mock.timers.tick(20000);
    assert.strictEqual(socket.sentMessages.length, 1);

    // Close socket
    socket.triggerClose();

    // No further pings should be sent
    mock.timers.tick(40000);
    assert.strictEqual(socket.sentMessages.length, 1);

    client.disconnect();
  });

  it('7. Heartbeat Lifecycle - Manual Disconnect Stops: manual disconnect cancels the heartbeat', () => {
    const client = new ExtensionWSClient();
    client.connect();

    const socket = MockWebSocket.instances[0] as any;
    socket.triggerOpen();

    mock.timers.tick(20000);
    assert.strictEqual(socket.sentMessages.length, 1);

    client.disconnect();

    mock.timers.tick(40000);
    assert.strictEqual(socket.sentMessages.length, 1);
  });

  it('8. Heartbeat Lifecycle - Reconnect Starts Fresh: successful reconnect starts a fresh single heartbeat', () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();

    let socket = MockWebSocket.instances[0] as any;
    socket.triggerOpen();

    mock.timers.tick(20000);
    assert.strictEqual(socket.sentMessages.length, 1);

    // Drop connection
    socket.triggerClose();

    // Advance 1000ms for reconnect backoff
    mock.timers.tick(1000);
    assert.strictEqual(MockWebSocket.instances.length, 2);

    const newSocket = MockWebSocket.instances[1] as any;
    newSocket.triggerOpen();

    // Tick 20s on new connection
    mock.timers.tick(20000);
    assert.strictEqual(newSocket.sentMessages.length, 1);
    assert.deepStrictEqual(JSON.parse(newSocket.sentMessages[0]), { type: 'PING' });

    // Tick another 20s
    mock.timers.tick(20000);
    assert.strictEqual(newSocket.sentMessages.length, 2);

    client.disconnect();
  });

  it('9. onConnect and onDisconnect callbacks: should trigger callbacks on connection state changes', () => {
    let connectCalls = 0;
    let disconnectCalls = 0;

    const client = new ExtensionWSClient({
      onConnect: () => {
        connectCalls++;
      },
      onDisconnect: () => {
        disconnectCalls++;
      },
    });

    client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    socket.triggerOpen();
    assert.strictEqual(connectCalls, 1);

    socket.triggerClose();
    assert.strictEqual(disconnectCalls, 1);

    client.disconnect();
  });

  it('10. connect() deduplicates CONNECTING state: multiple connect() calls during CONNECTING are no-ops', () => {
    const client = new ExtensionWSClient();
    client.connect();
    client.connect();
    client.connect();

    assert.strictEqual(
      MockWebSocket.instances.length,
      1,
      'Only one WebSocket instance should be created'
    );
    client.disconnect();
  });
});
