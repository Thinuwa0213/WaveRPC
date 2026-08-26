const Module = require('module');
const originalRequire = Module.prototype.require;

let mockElectronInstance: any = null;
Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    if (!mockElectronInstance) {
      mockElectronInstance = {
        app: {
          requestSingleInstanceLock: () => true,
          on: () => {},
          whenReady: async () => {},
          getVersion: () => '1.0.0',
          getPath: () => '',
          isPackaged: false,
        },
        ipcMain: {
          handle: () => {},
        },
      };
    }
    return mockElectronInstance;
  }
  return originalRequire.apply(this, arguments);
};

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { TypedEventEmitter } from '@waverpc/shared';
import { DiscordRPCClient } from '../rpc/discord.client.js';
import { PresenceManager } from '../presence/presence.manager.js';
import { WaveRPCDesktopApp } from './index.js';
import net from 'node:net';
import { EventEmitter } from 'events';

class MockSocket extends EventEmitter {
  public destroyed = false;
  constructor(public path: string) {
    super();
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
  emitConnect() {
    this.emit('connect');
  }
  emitError(err: Error) {
    this.emit('error', err);
  }
  write() {
    return true;
  }
}

async function flushMicrotasks(count = 15): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise((r) => queueMicrotask(() => r(undefined)));
  }
}

describe('Phase 4.3 Final Stability & Resilience Tests', () => {
  it('1. stale Discord client generations should resolve false on old in-flight connections', async () => {
    const socketsCreated: MockSocket[] = [];
    mock.method(net, 'createConnection', (path: string) => {
      const socket = new MockSocket(path);
      socketsCreated.push(socket);
      return socket;
    });

    const client = new DiscordRPCClient({
      clientId: '1542063156338229258',
      autoReconnect: false,
    });

    // Start connection
    const connectPromise = client.connect();

    assert.strictEqual(socketsCreated.length, 1);
    const staleSocket = socketsCreated[0];

    // Manually increment the generation to simulate a new connection attempt starting
    (client as any).connectionGeneration++;

    // Now simulate the stale socket connecting
    staleSocket.emitConnect();

    // It should be destroyed because generation mismatch
    assert.ok(staleSocket.destroyed, 'Stale generation socket must be destroyed immediately');

    const res = await connectPromise;
    assert.strictEqual(res, false, 'Stale connection attempt resolves false');

    await client.disconnect();
  });

  it('2. mid-scan socket cleanup should immediately destroy connectingSocket on disconnect()', async () => {
    const socketsCreated: MockSocket[] = [];
    mock.method(net, 'createConnection', (path: string) => {
      const socket = new MockSocket(path);
      socketsCreated.push(socket);
      return socket;
    });

    const client = new DiscordRPCClient({
      clientId: '1542063156338229258',
      autoReconnect: false,
    });

    const connectPromise = client.connect();
    assert.strictEqual(socketsCreated.length, 1);
    const activeConnectingSocket = socketsCreated[0];

    // Call disconnect mid-scan
    await client.disconnect();

    assert.ok(
      activeConnectingSocket.destroyed,
      'Connecting socket must be destroyed on disconnect'
    );

    const result = await connectPromise;
    assert.strictEqual(result, false, 'In-flight scan resolves false');
  });

  it('3. Discord reconnect presence restoration should re-apply active presence and respect shutdown', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '1542063156338229258' });
    const realClient = (pm as any).rpcClient;

    let setActivityCount = 0;
    let lastActivity: any = null;

    mock.method(realClient, 'setActivity', async (act: any) => {
      setActivityCount++;
      lastActivity = act;
      return true;
    });
    mock.method(realClient, 'clearActivity', async () => true);

    const mockTrack = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    (pm as any).currentTrack = mockTrack;
    (pm as any).currentPlaybackState = 'playing';

    // Trigger READY transition
    const onStateChangeHandler = (realClient as any).onStateChange;
    (realClient as any).state = 'READY';
    onStateChangeHandler('READY');

    assert.strictEqual(setActivityCount, 1, 'Should set activity upon reconnect');
    assert.strictEqual(lastActivity.details, 'Midnight City');

    // Shutdown blocks presence restoration on reconnect
    await pm.shutdown();
    setActivityCount = 0;
    (realClient as any).state = 'READY';
    onStateChangeHandler('READY');
    assert.strictEqual(setActivityCount, 0, 'No presence restoration after shutdown has started');
  });

  it('4. transport disconnect grace period should preserve playback, cancel on reconnect, and clear on expiry', async () => {
    mock.timers.enable();

    const app = new WaveRPCDesktopApp({ disconnectGracePeriodMs: 5000 });
    const appEvents = app.getEvents();

    (app as any).wsServer.start = async () => true;
    (app as any).wsServer.stop = async () => {};
    (app as any).wsServer.hasConnectedClients = () => false;
    (app as any).discordService.connect = async () => true;
    (app as any).discordService.disconnect = async () => {};

    const pm = (app as any).discordService.presenceManager;
    mock.method(pm, 'isConnected', () => true);
    mock.method(pm.rpcClient, 'setActivity', async () => true);
    mock.method(pm.rpcClient, 'clearActivity', async () => true);

    await app.bootstrap();

    appEvents.emit('extension:connected');
    appEvents.emit('provider:activated', 'soundcloud');
    const mockTrack = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    appEvents.emit('track:changed', mockTrack);

    // Wait for the presence update promise to resolve
    await flushMicrotasks();

    let status = app.getStatusService().getStatus();
    assert.strictEqual(status.extension.connected, true);
    assert.strictEqual(status.provider.active, true);
    assert.strictEqual(status.track?.title, 'Midnight City');

    // Final client disconnects -> starts 5s grace period
    appEvents.emit('extension:disconnected');

    status = app.getStatusService().getStatus();
    assert.strictEqual(status.extension.connected, false);
    assert.strictEqual(status.provider.active, true, 'Preserved');
    assert.ok(status.track, 'Preserved');

    // Tick 2000ms
    mock.timers.tick(2000);
    status = app.getStatusService().getStatus();
    assert.strictEqual(status.provider.active, true);

    // Reconnect during grace window
    (app as any).wsServer.hasConnectedClients = () => true;
    appEvents.emit('extension:connected');

    // Tick another 4000ms (reaches 6000ms from start)
    mock.timers.tick(4000);

    // Verify preservation remains active
    status = app.getStatusService().getStatus();
    assert.strictEqual(status.provider.active, true, 'Preserved because of reconnect');

    // Disconnect again
    (app as any).wsServer.hasConnectedClients = () => false;
    appEvents.emit('extension:disconnected');

    // Tick 6000ms -> expires
    mock.timers.tick(6000);

    status = app.getStatusService().getStatus();
    assert.strictEqual(status.provider.active, false, 'Cleared after grace expiry');
    assert.strictEqual(status.track, undefined, 'Cleared after grace expiry');

    await app.shutdown();
    mock.timers.reset();
  });

  it('5. multi-client safety should prevent grace period timer if other clients exist', async () => {
    mock.timers.enable();

    const app = new WaveRPCDesktopApp({ disconnectGracePeriodMs: 5000 });
    const appEvents = app.getEvents();

    let clientCount = 2;
    (app as any).wsServer.start = async () => true;
    (app as any).wsServer.stop = async () => {};
    (app as any).wsServer.hasConnectedClients = () => clientCount > 0;
    (app as any).discordService.connect = async () => true;
    (app as any).discordService.disconnect = async () => {};

    const pm = (app as any).discordService.presenceManager;
    mock.method(pm, 'isConnected', () => true);
    mock.method(pm.rpcClient, 'setActivity', async () => true);
    mock.method(pm.rpcClient, 'clearActivity', async () => true);

    await app.bootstrap();

    appEvents.emit('extension:connected');
    appEvents.emit('provider:activated', 'soundcloud');
    const mockTrack = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    appEvents.emit('track:changed', mockTrack);

    // Wait for the presence update promise to resolve
    await flushMicrotasks();

    // One client disconnects, 1 remains
    clientCount = 1;
    appEvents.emit('extension:disconnected');

    let status = app.getStatusService().getStatus();
    assert.strictEqual(status.extension.connected, true, 'Extension is still connected');
    assert.strictEqual(status.provider.active, true);

    // Tick 6000ms
    mock.timers.tick(6000);
    status = app.getStatusService().getStatus();
    assert.strictEqual(
      status.provider.active,
      true,
      'No expiry because extension was never considered disconnected'
    );

    // Final client disconnects
    clientCount = 0;
    appEvents.emit('extension:disconnected');

    status = app.getStatusService().getStatus();
    assert.strictEqual(status.extension.connected, false);

    // Tick 6000ms -> expires
    mock.timers.tick(6000);
    status = app.getStatusService().getStatus();
    assert.strictEqual(status.provider.active, false, 'Cleared on final disconnect expiry');

    await app.shutdown();
    mock.timers.reset();
  });

  it('6. authoritative TRACK_CLEAR should bypass grace period and clear immediately', async () => {
    mock.timers.enable();

    const app = new WaveRPCDesktopApp({ disconnectGracePeriodMs: 5000 });
    const appEvents = app.getEvents();

    (app as any).wsServer.start = async () => true;
    (app as any).wsServer.stop = async () => {};
    (app as any).wsServer.hasConnectedClients = () => false;
    (app as any).discordService.connect = async () => true;
    (app as any).discordService.disconnect = async () => {};

    const pm = (app as any).discordService.presenceManager;
    mock.method(pm, 'isConnected', () => true);
    let clearActivityCalled = 0;
    mock.method(pm.rpcClient, 'setActivity', async () => true);
    mock.method(pm.rpcClient, 'clearActivity', async () => {
      clearActivityCalled++;
      return true;
    });

    await app.bootstrap();

    appEvents.emit('extension:connected');
    appEvents.emit('provider:activated', 'soundcloud');
    const mockTrack = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    appEvents.emit('track:changed', mockTrack);

    // Wait for the presence update promise to resolve
    await flushMicrotasks();

    // Simulate final client disconnect -> starts grace timer
    appEvents.emit('extension:disconnected');

    // Emit authoritative TRACK_CLEAR
    appEvents.emit('track:changed', undefined);

    let status = app.getStatusService().getStatus();
    assert.strictEqual(status.provider.active, false, 'Should immediately clear provider');
    assert.strictEqual(status.track, undefined, 'Should immediately clear track');
    assert.strictEqual(clearActivityCalled, 1, 'Should call clearActivity immediately');

    // Tick 6000ms and verify no double clears
    clearActivityCalled = 0;
    mock.timers.tick(6000);
    assert.strictEqual(clearActivityCalled, 0, 'No secondary cleanup should trigger');

    await app.shutdown();
    mock.timers.reset();
  });
});
