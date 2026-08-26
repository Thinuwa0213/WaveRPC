import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TypedEventEmitter, DEFAULT_SETTINGS, WaveRPCSettings } from '@waverpc/shared';
import { WaveRPCWebSocketServer } from '../server/websocket.server.js';

// Global mock state
const electronMockState = {
  isPackaged: true,
  loginItemSettings: { openAtLogin: false, path: '' } as any,
  setLoginItemSettingsCalled: 0,
  setLoginItemSettingsThrow: false,
  quitCalledCount: 0,
  appListeners: {} as Record<string, Function[]>,
  windowCreatedCount: 0,
  windowInstances: [] as any[],
  trayCreatedCount: 0,
  trayInstances: [] as any[],
  secondInstanceListeners: [] as Function[],
  beforeQuitListeners: [] as Function[],
  tempUserDataDir: '',
  showErrorBoxCalled: [] as Array<{ title: string; content: string }>,
};

// Define mock Electron modules
const mockApp = {
  getAppPath: () => path.join(__dirname, '../..'),
  getVersion: () => '1.0.0',
  getPath: (name: string) => {
    if (name === 'userData') return electronMockState.tempUserDataDir;
    return electronMockState.tempUserDataDir;
  },
  requestSingleInstanceLock: () => true,
  quit: () => {
    electronMockState.quitCalledCount++;
  },
  on: (event: string, cb: Function) => {
    if (!electronMockState.appListeners[event]) {
      electronMockState.appListeners[event] = [];
    }
    electronMockState.appListeners[event].push(cb);
    if (event === 'second-instance') {
      electronMockState.secondInstanceListeners.push(cb);
    }
    if (event === 'before-quit') {
      electronMockState.beforeQuitListeners.push(cb);
    }
  },
  once: () => {},
  whenReady: () => Promise.resolve(),
  getLoginItemSettings: () => ({ openAtLogin: electronMockState.loginItemSettings.openAtLogin }),
  setLoginItemSettings: (opts: any) => {
    electronMockState.setLoginItemSettingsCalled++;
    if (electronMockState.setLoginItemSettingsThrow) {
      throw new Error('OS Registration Error');
    }
    electronMockState.loginItemSettings = opts;
  },
  get isPackaged() {
    return electronMockState.isPackaged;
  },
};

class MockBrowserWindow {
  public showCalled = 0;
  public hideCalled = 0;
  public focusCalled = 0;
  public restoreCalled = 0;
  public destroyCalled = 0;
  public isMinimizedVal = false;
  public showOption = true;
  public listeners: Record<string, Function[]> = {};
  public webContents = {
    send: (_channel: string, ..._args: any[]) => {},
  };

  constructor(opts: any) {
    electronMockState.windowCreatedCount++;
    this.showOption = opts.show !== undefined ? opts.show : true;
    electronMockState.windowInstances.push(this);
  }

  on(event: string, cb: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(cb);
  }

  once() {}
  loadURL() {
    return Promise.resolve();
  }
  setMenu() {}
  show() {
    this.showCalled++;
  }
  hide() {
    this.hideCalled++;
  }
  focus() {
    this.focusCalled++;
  }
  isMinimized() {
    return this.isMinimizedVal;
  }
  restore() {
    this.restoreCalled++;
  }
  destroy() {
    this.destroyCalled++;
  }
  isDestroyed() {
    return this.destroyCalled > 0;
  }
}

class MockTray {
  public setToolTipCalledCount = 0;
  public setContextMenuCalledCount = 0;
  public listeners: Record<string, Function[]> = {};

  constructor() {
    electronMockState.trayCreatedCount++;
    electronMockState.trayInstances.push(this);
  }

  setToolTip() {
    this.setToolTipCalledCount++;
  }
  setContextMenu() {
    this.setContextMenuCalledCount++;
  }
  on(event: string, cb: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(cb);
  }
  destroy() {}
}

const mockElectron = {
  app: mockApp,
  BrowserWindow: MockBrowserWindow,
  Menu: {
    buildFromTemplate: (template: any) => template,
  },
  Tray: MockTray,
  nativeImage: {
    createFromPath: () => ({}),
    createEmpty: () => ({}),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      ipcMainHandlers.set(channel, handler);
    },
  },
  dialog: {
    showErrorBox: (title: string, content: string) => {
      electronMockState.showErrorBoxCalled.push({ title, content });
    },
  },
};

// Intercept require('electron') using require.cache
require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: mockElectron,
} as any;

// Now import the tested classes
import { ElectronApp } from './electron-app.js';
import { PresenceManager } from '../presence/presence.manager.js';
import { WaveRPCTray } from '../tray/tray.js';

// Capture registered handlers map for direct unit-test triggers
const ipcMainHandlers = new Map<string, Function>();

describe('Windows Tray Lifecycle & Startup Behavior Tests', () => {
  let tempDir: string;
  let activeCoordinators: ElectronApp[] = [];
  let originalClientId: string | undefined;

  beforeEach(() => {
    process.env.WAVERPC_PORT = '0';
    originalClientId = process.env.DISCORD_CLIENT_ID;
    process.env.DISCORD_CLIENT_ID = '123456789012345678';
    activeCoordinators = [];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waverpc-tray-test-'));
    electronMockState.tempUserDataDir = tempDir;
    electronMockState.isPackaged = true;
    electronMockState.loginItemSettings = { openAtLogin: false, path: '' };
    electronMockState.setLoginItemSettingsCalled = 0;
    electronMockState.setLoginItemSettingsThrow = false;
    electronMockState.quitCalledCount = 0;
    electronMockState.windowCreatedCount = 0;
    electronMockState.windowInstances = [];
    electronMockState.trayCreatedCount = 0;
    electronMockState.trayInstances = [];
    electronMockState.secondInstanceListeners = [];
    electronMockState.beforeQuitListeners = [];
    electronMockState.appListeners = {};
    electronMockState.showErrorBoxCalled = [];
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

  async function createReadyApp(
    settingsOverwrites: Partial<WaveRPCSettings> = {}
  ): Promise<ElectronApp> {
    const settingsFile = path.join(tempDir, 'settings.json');
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ ...DEFAULT_SETTINGS, ...settingsOverwrites }, null, 2),
      'utf-8'
    );

    const coordinator = new ElectronApp();
    activeCoordinators.push(coordinator);

    // Simulate app ready
    const whenReadyPromise = electronMockState.appListeners['ready']
      ? Promise.all(electronMockState.appListeners['ready'].map((cb) => cb()))
      : Promise.resolve();
    await whenReadyPromise;

    // Wait for the async bootstrap microtask queue to clear and instantiate window
    await new Promise((resolve) => setTimeout(resolve, 50));
    return coordinator;
  }

  it('1. minimizeToTray=true + window close hides the window and keeps app running', async () => {
    const coordinator = await createReadyApp({ minimizeToTray: true });

    const mainWindowInstance = (coordinator as any).mainWindow;
    assert.ok(mainWindowInstance, 'MainWindow should be instantiated');

    const win: MockBrowserWindow = (mainWindowInstance as any).window;
    assert.ok(win, 'Underlying BrowserWindow should exist');

    // Trigger close event
    let preventDefaultCalled = 0;
    const mockEvent = {
      preventDefault: () => {
        preventDefaultCalled++;
      },
    };

    assert.ok(win.listeners['close'], 'Close listener should be registered');
    win.listeners['close'].forEach((cb) => cb(mockEvent));

    assert.strictEqual(preventDefaultCalled, 1, 'Should call preventDefault()');
    assert.strictEqual(win.hideCalled, 1, 'Should hide the window');
    assert.strictEqual(electronMockState.quitCalledCount, 0, 'Should not terminate app');
  });

  it('2. minimizeToTray=false + window close triggers clean shutdown', async () => {
    const coordinator = await createReadyApp({ minimizeToTray: false });

    const mainWindowInstance = (coordinator as any).mainWindow;
    assert.ok(mainWindowInstance, 'MainWindow should be instantiated');

    const win: MockBrowserWindow = (mainWindowInstance as any).window;
    assert.ok(win, 'Underlying BrowserWindow should exist');

    let preventDefaultCalled = 0;
    const mockEvent = {
      preventDefault: () => {
        preventDefaultCalled++;
      },
    };

    // Close window
    win.listeners['close'].forEach((cb) => cb(mockEvent));

    assert.strictEqual(preventDefaultCalled, 1, 'Should call preventDefault() to allow clean quit');
    assert.strictEqual(win.hideCalled, 1, 'Should hide window immediately for prompt feedback');
    assert.strictEqual(coordinator.getQuittingFlag(), true, 'Quitting flag should be set');
  });

  it('3. Explicit Quit via Tray / quitApp() overrides minimizeToTray and cleans up exactly once', async () => {
    const coordinator = await createReadyApp();

    assert.strictEqual(coordinator.getQuittingFlag(), false);

    // Call quit
    coordinator.quitApp();

    assert.strictEqual(coordinator.getQuittingFlag(), true);
  });

  it('4. showMainWindow restores minimized window and focuses it', async () => {
    const coordinator = await createReadyApp();
    const mainWindowInstance = (coordinator as any).mainWindow;
    assert.ok(mainWindowInstance);

    const win: MockBrowserWindow = (mainWindowInstance as any).window;
    win.isMinimizedVal = true;

    coordinator.showMainWindow();

    assert.strictEqual(win.restoreCalled, 1);
    assert.strictEqual(win.showCalled, 1);
    assert.strictEqual(win.focusCalled, 1);
  });

  it('5. startMinimized=true registers BrowserWindow with show: false', async () => {
    const coordinator = await createReadyApp({ startMinimized: true });
    const mainWindowInstance = (coordinator as any).mainWindow;
    assert.ok(mainWindowInstance);

    const win: MockBrowserWindow = (mainWindowInstance as any).window;
    assert.strictEqual(win.showOption, false, 'Window show option should be false');
  });

  it('6. startMinimized=false registers BrowserWindow with show: true', async () => {
    const coordinator = await createReadyApp({ startMinimized: false });
    const mainWindowInstance = (coordinator as any).mainWindow;
    assert.ok(mainWindowInstance);

    const win: MockBrowserWindow = (mainWindowInstance as any).window;
    assert.strictEqual(win.showOption, true, 'Window show option should be true');
  });

  it('7. packaged launchAtStartup=true applies openAtLogin:true', async () => {
    const coordinator = await createReadyApp();
    electronMockState.isPackaged = true;

    // Simulate IPC call for update-setting
    const service = coordinator.getSettingsService();
    assert.ok(service);

    const updateHandler = ipcMainHandlers.get('update-setting');
    assert.ok(updateHandler);

    electronMockState.setLoginItemSettingsCalled = 0;
    const result = await updateHandler({}, { key: 'launchAtStartup', value: true });

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(electronMockState.setLoginItemSettingsCalled, 1);
    assert.strictEqual(electronMockState.loginItemSettings.openAtLogin, true);
  });

  it('8. dev mode does not register startup and logs information', async () => {
    await createReadyApp();
    electronMockState.isPackaged = false;
    electronMockState.setLoginItemSettingsCalled = 0;

    const updateHandler = ipcMainHandlers.get('update-setting');
    assert.ok(updateHandler);

    const result = await updateHandler({}, { key: 'launchAtStartup', value: true });

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(electronMockState.setLoginItemSettingsCalled, 0);
  });

  it('9. second-instance restores hidden window', async () => {
    const coordinator = await createReadyApp();
    const mainWindowInstance = (coordinator as any).mainWindow;
    assert.ok(mainWindowInstance);
    const win: MockBrowserWindow = (mainWindowInstance as any).window;

    // Trigger second instance listener
    assert.ok(electronMockState.secondInstanceListeners.length > 0);
    electronMockState.secondInstanceListeners.forEach((cb) => cb());

    assert.strictEqual(win.showCalled, 1, 'Should restore and show existing window');
  });

  it('10. Discord active presence receives bounded clear attempt during shutdown', async () => {
    const events = new TypedEventEmitter();
    const presenceManager = new PresenceManager(events, { clientId: '123' });

    // Set state to active
    (presenceManager as any).presenceState = 'ACTIVE';

    let clearCalled = 0;
    (presenceManager as any).rpcClient = {
      clearActivity: async () => {
        clearCalled++;
        return true;
      },
      disconnect: async () => {},
    };

    await presenceManager.shutdown();
    assert.strictEqual(clearCalled, 1, 'Should call clearActivity on shutdown');
  });

  it('11. tray status listener is cleaned up on destroy', () => {
    const coordinator = new ElectronApp();
    activeCoordinators.push(coordinator);
    const events = new TypedEventEmitter();
    const tray = new WaveRPCTray(coordinator, events);

    let updateMenuCalled = 0;
    (tray as any).updateTrayMenu = () => {
      updateMenuCalled++;
    };

    // Emit status:changed, should invoke updateTrayMenu
    events.emit('status:changed', {} as any);
    assert.strictEqual(updateMenuCalled, 1, 'Should call updateTrayMenu on status:changed');

    // Destroy the tray
    tray.destroy();

    // Emit again, should NOT invoke updateTrayMenu
    events.emit('status:changed', {} as any);
    assert.strictEqual(updateMenuCalled, 1, 'Should NOT call updateTrayMenu again after destroy');
  });

  it('12. port conflict (EADDRINUSE) during bootstrap shows port-specific error box and quits cleanly', async () => {
    const originalStart = WaveRPCWebSocketServer.prototype.start;
    WaveRPCWebSocketServer.prototype.start = async function () {
      const err = new Error('EADDRINUSE mock error');
      (err as any).code = 'EADDRINUSE';
      throw err;
    };

    try {
      const coordinator = new ElectronApp();
      activeCoordinators.push(coordinator);

      // Trigger app ready
      const whenReadyPromise = electronMockState.appListeners['ready']
        ? Promise.all(electronMockState.appListeners['ready'].map((cb) => cb()))
        : Promise.resolve();
      await whenReadyPromise;

      // Wait for async bootstrap tasks to resolve
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(electronMockState.showErrorBoxCalled.length, 1);
      assert.strictEqual(electronMockState.showErrorBoxCalled[0].title, 'WaveRPC Launch Error');
      assert.ok(
        electronMockState.showErrorBoxCalled[0].content.includes('port 6124 is already in use')
      );
      assert.strictEqual(electronMockState.quitCalledCount, 1);
    } finally {
      WaveRPCWebSocketServer.prototype.start = originalStart;
    }
  });

  it('13. generic bootstrap failure shows generic error box and quits cleanly', async () => {
    const originalStart = WaveRPCWebSocketServer.prototype.start;
    WaveRPCWebSocketServer.prototype.start = async function () {
      throw new Error('Generic database error');
    };

    try {
      const coordinator = new ElectronApp();
      activeCoordinators.push(coordinator);

      // Trigger app ready
      const whenReadyPromise = electronMockState.appListeners['ready']
        ? Promise.all(electronMockState.appListeners['ready'].map((cb) => cb()))
        : Promise.resolve();
      await whenReadyPromise;

      // Wait for async bootstrap tasks to resolve
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(electronMockState.showErrorBoxCalled.length, 1);
      assert.strictEqual(electronMockState.showErrorBoxCalled[0].title, 'WaveRPC Launch Error');
      assert.ok(
        electronMockState.showErrorBoxCalled[0].content.includes(
          'Technical cause: Generic database error'
        )
      );
      assert.strictEqual(electronMockState.quitCalledCount, 1);
    } finally {
      WaveRPCWebSocketServer.prototype.start = originalStart;
    }
  });
});
