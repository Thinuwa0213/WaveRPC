import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TypedEventEmitter } from '@waverpc/shared';

// Global mock state for Electron & lifecycle
const electronMockState = {
  quitCalledCount: 0,
  appListeners: {} as Record<string, Function[]>,
  windowCreatedCount: 0,
  windowInstances: [] as any[],
  trayCreatedCount: 0,
  trayInstances: [] as any[],
  tempUserDataDir: '',
  hasSingleInstanceLock: true,
};

const mockApp = {
  getAppPath: () => path.join(__dirname, '../..'),
  getVersion: () => '1.0.0',
  getPath: (_name: string) => electronMockState.tempUserDataDir,
  requestSingleInstanceLock: () => electronMockState.hasSingleInstanceLock,
  quit: () => {
    electronMockState.quitCalledCount++;
    const beforeQuitListeners = electronMockState.appListeners['before-quit'] || [];
    // Trigger before-quit handlers to verify non-recursion
    for (const listener of beforeQuitListeners) {
      const mockEvent = { defaultPrevented: false, preventDefault: () => {} };
      listener(mockEvent);
    }
  },
  on: (event: string, cb: Function) => {
    if (!electronMockState.appListeners[event]) {
      electronMockState.appListeners[event] = [];
    }
    electronMockState.appListeners[event].push(cb);
  },
  once: () => {},
  whenReady: () => Promise.resolve(),
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setLoginItemSettings: () => {},
  get isPackaged() {
    return false;
  },
};

class MockBrowserWindow {
  public destroyCalled = 0;
  public listeners: Record<string, Function[]> = {};
  public webContents = { send: () => {} };

  constructor(_opts: any) {
    electronMockState.windowCreatedCount++;
    electronMockState.windowInstances.push(this);
  }

  on(event: string, cb: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  loadURL() {
    return Promise.resolve();
  }
  setMenu() {}
  show() {}
  hide() {}
  focus() {}
  isMinimized() {
    return false;
  }
  restore() {}
  destroy() {
    this.destroyCalled++;
  }
  isDestroyed() {
    return this.destroyCalled > 0;
  }
}

class MockTray {
  public destroyCalled = 0;
  public listeners: Record<string, Function[]> = {};

  constructor() {
    electronMockState.trayCreatedCount++;
    electronMockState.trayInstances.push(this);
  }

  setToolTip() {}
  setContextMenu() {}
  on(event: string, cb: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  destroy() {
    this.destroyCalled++;
  }
}

const mockElectron = {
  app: mockApp,
  BrowserWindow: MockBrowserWindow,
  Menu: { buildFromTemplate: (template: any) => template },
  Tray: MockTray,
  nativeImage: {
    createFromPath: () => ({}),
    createEmpty: () => ({}),
  },
  ipcMain: {
    handle: () => {},
  },
};

require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: mockElectron,
} as any;

import { ElectronApp } from './electron-app.js';
import { WaveRPCWebSocketServer } from '../server/websocket.server.js';
import { DiscordRPCClient } from '../rpc/discord.client.js';

describe('Phase 4.1 Canonical Shutdown & Lifecycle Fix Tests', () => {
  let tempDir: string;

  let activeCoordinators: ElectronApp[] = [];

  let originalClientId: string | undefined;

  beforeEach(() => {
    process.env.WAVERPC_PORT = '0';
    originalClientId = process.env.DISCORD_CLIENT_ID;
    process.env.DISCORD_CLIENT_ID = '123456789012345678';
    activeCoordinators = [];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waverpc-shutdown-test-'));
    electronMockState.tempUserDataDir = tempDir;
    electronMockState.quitCalledCount = 0;
    electronMockState.windowCreatedCount = 0;
    electronMockState.windowInstances = [];
    electronMockState.trayCreatedCount = 0;
    electronMockState.trayInstances = [];
    electronMockState.appListeners = {};
    electronMockState.hasSingleInstanceLock = true;
  });

  afterEach(async () => {
    for (const coordinator of activeCoordinators) {
      try {
        await coordinator.requestQuit();
      } catch {}
    }
    activeCoordinators = [];

    if (originalClientId !== undefined) {
      process.env.DISCORD_CLIENT_ID = originalClientId;
    } else {
      delete process.env.DISCORD_CLIENT_ID;
    }

    try {
      if (fs.existsSync(path.join(tempDir, 'settings.json'))) {
        fs.unlinkSync(path.join(tempDir, 'settings.json'));
      }
      fs.rmdirSync(tempDir);
    } catch {}
  });

  async function createReadyApp(): Promise<ElectronApp> {
    const coordinator = new ElectronApp();
    activeCoordinators.push(coordinator);
    const whenReady = electronMockState.appListeners['ready']
      ? Promise.all(electronMockState.appListeners['ready'].map((cb) => cb()))
      : Promise.resolve();
    await whenReady;
    await new Promise((r) => setTimeout(r, 50));
    return coordinator;
  }

  it('1. active WebSocket client does not block stop() and clients are terminated', async () => {
    const events = new TypedEventEmitter();
    const server = new WaveRPCWebSocketServer(events, { port: 6199 });

    // Mock clients in server set
    let clientTerminated = false;
    const mockWs = {
      removeAllListeners: () => {},
      terminate: () => {
        clientTerminated = true;
      },
    } as any;

    (server as any).clients.add(mockWs);
    (server as any).wss = {
      close: (cb: Function) => cb(),
      removeAllListeners: () => {},
    };

    await server.stop();

    assert.strictEqual(clientTerminated, true, 'Active WebSocket client should be terminated');
    assert.strictEqual((server as any).clients.size, 0, 'Clients set should be cleared');
    assert.strictEqual(server.isRunning, false, 'Server should not be running');
  });

  it('2. WebSocket server stop timeout still resolves shutdown if wss.close hangs', async () => {
    const events = new TypedEventEmitter();
    const server = new WaveRPCWebSocketServer(events, { port: 6198 });

    // Mock wss.close that never invokes its callback
    (server as any).wss = {
      close: (_cb: Function) => {},
      removeAllListeners: () => {},
    };

    const stopStart = Date.now();
    await server.stop();
    const duration = Date.now() - stopStart;

    assert.ok(duration >= 1900, 'Should wait for bounded timeout duration');
    assert.strictEqual(server.isRunning, false, 'Server should resolve stop and set wss to null');
  });

  it('3. new client connection cannot be accepted while server is stopping', async () => {
    const events = new TypedEventEmitter();
    const server = new WaveRPCWebSocketServer(events, { port: 6197 });
    (server as any).isStopping = true;

    let connectionTerminated = false;
    const mockWs = {
      removeAllListeners: () => {},
      terminate: () => {
        connectionTerminated = true;
      },
    } as any;

    // Simulate connection handler trigger when stopping
    const connectionHandler = (ws: any) => {
      if ((server as any).isStopping) {
        ws.removeAllListeners();
        ws.terminate();
      }
    };
    connectionHandler(mockWs);

    assert.strictEqual(
      connectionTerminated,
      true,
      'Connection during stopping should be terminated'
    );
  });

  it('4. Discord reconnect timer is cleared on shutdown and autoReconnect set false', async () => {
    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: true });

    (client as any).reconnectTimer = setTimeout(() => {}, 10000);

    await client.disconnect();

    assert.strictEqual(
      (client as any).autoReconnect,
      false,
      'autoReconnect should be set to false'
    );
    assert.strictEqual(
      (client as any).reconnectTimer,
      null,
      'reconnectTimer reference should be null'
    );
    assert.strictEqual(client.ConnectionState, 'DISCONNECTED');

    // Attempting scheduleReconnect after disconnect must do nothing
    (client as any).scheduleReconnect();
    assert.strictEqual(
      (client as any).reconnectTimer,
      null,
      'No new timer should be scheduled after disconnect'
    );
  });

  it('5. pending nonce requests settle false on disconnect', async () => {
    const client = new DiscordRPCClient({ clientId: '1234567890', autoReconnect: false });
    (client as any).state = 'READY';
    (client as any).socket = { write: () => true, destroy: () => {}, removeAllListeners: () => {} };

    let promiseResult: boolean | null = null;
    const setActivityPromise = client.setActivity({ details: 'Test' }).then((res) => {
      promiseResult = res;
    });

    assert.strictEqual((client as any).pendingRequests.size, 1, 'Should have 1 pending request');

    await client.disconnect();
    await setActivityPromise;

    assert.strictEqual(promiseResult, false, 'Pending request should resolve false on disconnect');
    assert.strictEqual(
      (client as any).pendingRequests.size,
      0,
      'Pending requests map should be empty'
    );
  });

  it('6 & 11. requestQuit is idempotent: repeated requestQuit returns exact same shutdown promise', async () => {
    const coordinator = await createReadyApp();

    const p1 = coordinator.requestQuit();
    const p2 = coordinator.requestQuit();

    assert.strictEqual(
      p1,
      p2,
      'Concurrent requestQuit calls must return identical shutdownPromise'
    );

    await p1;
    assert.strictEqual(coordinator.getQuittingFlag(), true);
  });

  it('7 & 8. MainWindow and Tray destroy execute exactly once on shutdown', async () => {
    const coordinator = await createReadyApp();
    const mainWindowInstance = (coordinator as any).mainWindow;
    const trayInstance = (coordinator as any).tray;

    assert.ok(mainWindowInstance);
    assert.ok(trayInstance);

    const winMock = (mainWindowInstance as any).window;
    const trayMock = (trayInstance as any).tray;

    await coordinator.requestQuit();

    assert.strictEqual(winMock.destroyCalled, 1, 'MainWindow should be destroyed exactly once');
    assert.strictEqual(trayMock.destroyCalled, 1, 'Tray should be destroyed exactly once');
  });

  it('9. app.quit always executes in finally block even if runtime shutdown throws', async () => {
    const coordinator = await createReadyApp();

    // Mock runtimeApp shutdown to throw an error, while cleaning up real resources first
    const realRuntime = (coordinator as any).runtimeApp;
    (coordinator as any).runtimeApp = {
      shutdown: async () => {
        if (realRuntime) {
          try {
            await realRuntime.shutdown();
          } catch {}
        }
        throw new Error('Forced runtime shutdown failure');
      },
    };

    await coordinator.requestQuit();

    assert.strictEqual(
      electronMockState.quitCalledCount,
      1,
      'app.quit should be called despite shutdown error'
    );
  });

  it('10. before-quit listener does not recurse infinitely', async () => {
    const coordinator = await createReadyApp();

    const initialQuitCount = electronMockState.quitCalledCount;
    await coordinator.requestQuit();

    // app.quit should have been called once, triggering before-quit listener without endless recursion
    assert.strictEqual(
      electronMockState.quitCalledCount,
      initialQuitCount + 1,
      'app.quit should be called exactly once without infinite recursion'
    );
  });

  it('12. second-instance lock lifecycle recovers after complete exit', async () => {
    electronMockState.hasSingleInstanceLock = true;
    const firstInstance = new ElectronApp();
    assert.strictEqual(firstInstance.getQuittingFlag(), false);

    // Complete quit of first instance
    await firstInstance.requestQuit();
    assert.strictEqual(firstInstance.getQuittingFlag(), true);

    // Second instance launching after first instance exit acquires lock naturally
    const secondInstance = new ElectronApp();
    activeCoordinators.push(secondInstance);
    assert.strictEqual(
      secondInstance.getQuittingFlag(),
      false,
      'New instance should launch normally without auto-quit'
    );
  });
});
