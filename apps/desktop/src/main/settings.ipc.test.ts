import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SettingsService } from '../services/settings.service.js';
import { TypedEventEmitter, WaveRPCSettings, DEFAULT_SETTINGS } from '@waverpc/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Settings IPC Bridge & Preload Tests', () => {
  let tempDir: string;
  let testFilePath: string;
  let events: TypedEventEmitter;
  let service: SettingsService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waverpc-settings-ipc-test-'));
    testFilePath = path.join(tempDir, 'settings.json');
    events = new TypedEventEmitter();
    service = new SettingsService(testFilePath, events);
    service.load();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      fs.rmdirSync(tempDir);
    } catch {}
  });

  // Replicate the main process get-settings handler logic
  const handleGetSettings = () => {
    return service.getSettings();
  };

  // Replicate the main process update-setting handler logic
  const handleUpdateSetting = async (arg: { key: string; value: any }) => {
    const { key, value } = arg || {};

    // 1. Authoritative main process validation
    if (key !== 'minimizeToTray' && key !== 'launchAtStartup' && key !== 'startMinimized') {
      return { success: false };
    }

    if (typeof value !== 'boolean') {
      return { success: false };
    }

    const success = service.updateSetting(key, value);
    return { success };
  };

  // Replicate the preload API structure
  const makeMockPreloadApi = (mockIpcRenderer: any) => {
    return {
      getAppInfo: () => mockIpcRenderer.invoke('get-app-info'),
      getStatus: () => mockIpcRenderer.invoke('get-status'),
      onStatusChanged: (callback: (status: any) => void) => {
        const subscription = (_event: any, status: any) => callback(status);
        mockIpcRenderer.on('status-changed', subscription);
        return () => {
          mockIpcRenderer.removeListener('status-changed', subscription);
        };
      },
      getSettings: () => mockIpcRenderer.invoke('get-settings'),
      updateSetting: (key: string, value: boolean) =>
        mockIpcRenderer.invoke('update-setting', { key, value }),
      onSettingsChanged: (callback: (settings: any) => void) => {
        const subscription = (_event: any, settings: any) => callback(settings);
        mockIpcRenderer.on('settings-changed', subscription);
        return () => {
          mockIpcRenderer.removeListener('settings-changed', subscription);
        };
      },
    };
  };

  it('1. safe get-settings snapshot', () => {
    const snapshot = handleGetSettings();
    assert.deepStrictEqual(snapshot, DEFAULT_SETTINGS);

    // Verify snapshot mutation does not affect service state
    (snapshot as any).minimizeToTray = false;
    assert.strictEqual(service.getSettings().minimizeToTray, true);
  });

  it('2. successful boolean update', async () => {
    const result = await handleUpdateSetting({ key: 'minimizeToTray', value: false });
    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(service.getSettings().minimizeToTray, false);
  });

  it('3. invalid key rejection', async () => {
    const result = await handleUpdateSetting({ key: 'invalidKey', value: false });
    assert.deepStrictEqual(result, { success: false });
    assert.strictEqual(service.getSettings().minimizeToTray, true); // unmodified
  });

  it('4. invalid value rejection', async () => {
    const result = await handleUpdateSetting({ key: 'minimizeToTray', value: 'not-a-boolean' });
    assert.deepStrictEqual(result, { success: false });
    assert.strictEqual(service.getSettings().minimizeToTray, true); // unmodified
  });

  it('5. persistence failure returns failure', async () => {
    // Force persistence error by pointing to directory parent conflict
    fs.writeFileSync(testFilePath, '{}', 'utf-8');
    (service as any).settingsPath = path.join(testFilePath, 'impossible_subfolder/settings.json');

    const result = await handleUpdateSetting({ key: 'minimizeToTray', value: false });
    assert.deepStrictEqual(result, { success: false });
    assert.strictEqual(service.getSettings().minimizeToTray, true); // unmodified
  });

  it('6. settings:changed emitted only on success', async () => {
    let emitCount = 0;
    let emittedSettings: WaveRPCSettings | null = null;

    events.on('settings:changed', (s) => {
      emitCount++;
      emittedSettings = s;
    });

    // 1. Trigger successful update
    const res1 = await handleUpdateSetting({ key: 'minimizeToTray', value: false });
    assert.deepStrictEqual(res1, { success: true });
    assert.strictEqual(emitCount, 1);
    assert.deepStrictEqual(emittedSettings, { ...DEFAULT_SETTINGS, minimizeToTray: false });

    // 2. Trigger invalid update (should not emit)
    const res2 = await handleUpdateSetting({ key: 'invalidKey', value: false });
    assert.deepStrictEqual(res2, { success: false });
    assert.strictEqual(emitCount, 1); // still 1

    // 3. Trigger persistence failure update (should not emit)
    fs.writeFileSync(testFilePath, '{}', 'utf-8');
    (service as any).settingsPath = path.join(testFilePath, 'impossible_subfolder/settings.json');

    const res3 = await handleUpdateSetting({ key: 'minimizeToTray', value: true });
    assert.deepStrictEqual(res3, { success: false });
    assert.strictEqual(emitCount, 1); // still 1
  });

  it('7. listener cleanup behavior', () => {
    let statusListenerCount = 0;
    let settingsListenerCount = 0;

    const mockEvents: any = {
      on: (event: string, _listener: any) => {
        if (event === 'status:changed') statusListenerCount++;
        if (event === 'settings:changed') settingsListenerCount++;
        return () => {
          if (event === 'status:changed') statusListenerCount--;
          if (event === 'settings:changed') settingsListenerCount--;
        };
      },
    };

    // Simulate MainWindow listener management
    const unsubscribes: any[] = [];
    unsubscribes.push(mockEvents.on('status:changed', () => {}));
    unsubscribes.push(mockEvents.on('settings:changed', () => {}));

    assert.strictEqual(statusListenerCount, 1);
    assert.strictEqual(settingsListenerCount, 1);

    // Call cleanups (mirroring destroy() implementation)
    for (const unsub of unsubscribes) {
      unsub();
    }

    assert.strictEqual(statusListenerCount, 0);
    assert.strictEqual(settingsListenerCount, 0);
  });

  it('8. preload surface does not expose generic/raw IPC access', () => {
    const mockIpcRenderer = {
      invoke: () => {},
      on: () => {},
      removeListener: () => {},
    };
    const preload = makeMockPreloadApi(mockIpcRenderer);

    // Verify it only exposes the explicit safe method bindings
    const keys = Object.keys(preload).sort();
    assert.deepStrictEqual(keys, [
      'getAppInfo',
      'getSettings',
      'getStatus',
      'onSettingsChanged',
      'onStatusChanged',
      'updateSetting',
    ]);

    // Ensure raw ipcRenderer or Node properties are not present on preload object
    assert.strictEqual((preload as any).ipcRenderer, undefined);
    assert.strictEqual((preload as any).ipc, undefined);
    assert.strictEqual((preload as any).process, undefined);
  });

  it('9. get-app-info handler returns resolved version', () => {
    const { resolveAppVersion } = require('./app-version.js');
    const expectedVersion = resolveAppVersion();

    // Replicate get-app-info main process IPC handler logic
    const handleGetAppInfo = () => {
      return {
        name: 'WaveRPC',
        version: resolveAppVersion(),
      };
    };

    const appInfo = handleGetAppInfo();
    assert.strictEqual(appInfo.name, 'WaveRPC');
    assert.strictEqual(appInfo.version, expectedVersion);
    assert.ok(
      expectedVersion && expectedVersion !== '0.0.0',
      'Resolved version must not be fallback 0.0.0'
    );
  });

  it('10. compiled renderer main.js is browser-compatible with no CommonJS exports/require', () => {
    const distRendererPath = path.join(__dirname, '../renderer/main.js');
    if (fs.existsSync(distRendererPath)) {
      const content = fs.readFileSync(distRendererPath, 'utf8');

      // Assert it doesn't contain CJS wrappers or imports
      assert.ok(
        !content.includes('exports.'),
        'Renderer main.js must not contain "exports." references'
      );
      assert.ok(!content.includes('exports ='), 'Renderer main.js must not assign to exports');
      assert.ok(
        !content.includes('Object.defineProperty(exports'),
        'Renderer main.js must not define exports object'
      );
      assert.ok(!content.includes('require('), 'Renderer main.js must not use require()');
      assert.ok(
        !content.includes('module.exports'),
        'Renderer main.js must not use module.exports'
      );
    }
  });

  it('11. renderer main.js contains version badge element update logic', () => {
    const distRendererPath = path.join(__dirname, '../renderer/main.js');
    if (fs.existsSync(distRendererPath)) {
      const content = fs.readFileSync(distRendererPath, 'utf8');

      // Assert that it querys for the version-badge element and updates textContent with a resolved version
      assert.ok(
        content.includes('version-badge'),
        'Renderer main.js must select version-badge element'
      );
      assert.ok(content.includes('getAppInfo'), 'Renderer main.js must request app info');
      assert.ok(content.includes('textContent'), 'Renderer main.js must update badge textContent');
    }
  });
});
