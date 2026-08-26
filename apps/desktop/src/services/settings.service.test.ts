import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SettingsService } from './settings.service.js';
import { DEFAULT_SETTINGS } from '@waverpc/shared';

describe('SettingsService Tests', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    // Create an isolated temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waverpc-settings-test-'));
    testFilePath = path.join(tempDir, 'settings.json');
  });

  afterEach(() => {
    // Clean up temp directory files
    try {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      const tmpFile = `${testFilePath}.tmp`;
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
      fs.rmdirSync(tempDir);
    } catch {}
  });

  it('1. missing file -> defaults', () => {
    const service = new SettingsService(testFilePath);
    service.load();

    assert.deepStrictEqual(service.getSettings(), DEFAULT_SETTINGS);
  });

  it('2. valid complete settings file', () => {
    const customSettings = {
      minimizeToTray: false,
      launchAtStartup: true,
      startMinimized: true,
    };
    fs.writeFileSync(testFilePath, JSON.stringify(customSettings), 'utf-8');

    const service = new SettingsService(testFilePath);
    service.load();

    assert.deepStrictEqual(service.getSettings(), customSettings);
  });

  it('3. partial valid settings file', () => {
    const partialSettings = {
      minimizeToTray: false,
      // launchAtStartup and startMinimized are missing
    };
    fs.writeFileSync(testFilePath, JSON.stringify(partialSettings), 'utf-8');

    const service = new SettingsService(testFilePath);
    service.load();

    const expected = {
      ...DEFAULT_SETTINGS,
      minimizeToTray: false,
    };
    assert.deepStrictEqual(service.getSettings(), expected);
  });

  it('4. unknown keys ignored', () => {
    const customSettings = {
      minimizeToTray: false,
      launchAtStartup: true,
      startMinimized: false,
      unknownKey: 'some-value',
      anotherUnknown: 1234,
    };
    fs.writeFileSync(testFilePath, JSON.stringify(customSettings), 'utf-8');

    const service = new SettingsService(testFilePath);
    service.load();

    // Verify it loads the settings snapshot without the extra keys
    const loaded = service.getSettings() as any;
    assert.strictEqual(loaded.unknownKey, undefined);
    assert.strictEqual(loaded.anotherUnknown, undefined);
    assert.strictEqual(loaded.minimizeToTray, false);
    assert.strictEqual(loaded.launchAtStartup, true);
  });

  it('5. invalid value types ignored/fallback', () => {
    const badSettings = {
      minimizeToTray: 'not-a-boolean', // invalid type
      launchAtStartup: true,
      startMinimized: false,
    };
    fs.writeFileSync(testFilePath, JSON.stringify(badSettings), 'utf-8');

    const service = new SettingsService(testFilePath);
    service.load();

    const expected = {
      minimizeToTray: DEFAULT_SETTINGS.minimizeToTray, // fallback to default
      launchAtStartup: true,
      startMinimized: false,
    };
    assert.deepStrictEqual(service.getSettings(), expected);
  });

  it('6. malformed JSON fallback', () => {
    // Write syntactically invalid JSON
    fs.writeFileSync(testFilePath, '{ invalid json structure ... ', 'utf-8');

    const service = new SettingsService(testFilePath);
    service.load();

    // Must not crash and fall back to defaults
    assert.deepStrictEqual(service.getSettings(), DEFAULT_SETTINGS);

    // Ensure the original malformed file is NOT overwritten on load
    const contents = fs.readFileSync(testFilePath, 'utf-8');
    assert.ok(contents.startsWith('{ invalid'));
  });

  it('7. single setting update', () => {
    const service = new SettingsService(testFilePath);
    service.load();

    // Update minimizeToTray from true -> false
    service.updateSetting('minimizeToTray', false);

    assert.strictEqual(service.getSettings().minimizeToTray, false);

    // Verify file on disk is written
    const fileContents = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
    assert.strictEqual(fileContents.minimizeToTray, false);
  });

  it('8. multi-setting update', () => {
    const service = new SettingsService(testFilePath);
    service.load();

    // Perform multi-setting update
    service.updateSettings({
      launchAtStartup: true,
      startMinimized: true,
    });

    const current = service.getSettings();
    assert.strictEqual(current.launchAtStartup, true);
    assert.strictEqual(current.startMinimized, true);
    assert.strictEqual(current.minimizeToTray, DEFAULT_SETTINGS.minimizeToTray);

    // Verify disk content
    const fileContents = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
    assert.strictEqual(fileContents.launchAtStartup, true);
    assert.strictEqual(fileContents.startMinimized, true);
  });

  it('9. persisted reload', () => {
    const service1 = new SettingsService(testFilePath);
    service1.load();
    service1.updateSetting('minimizeToTray', false);

    // Instantiate a new service pointing to the same file
    const service2 = new SettingsService(testFilePath);
    service2.load();

    assert.strictEqual(service2.getSettings().minimizeToTray, false);
  });

  it('10. failed persistence does not silently corrupt state', () => {
    const service = new SettingsService(testFilePath);
    service.load();

    // Create a file at the target path, then set settingsPath to be a child under it.
    // Since testFilePath is a file, trying to create directories/files under it will fail with ENOTDIR.
    fs.writeFileSync(testFilePath, '{}', 'utf-8');
    (service as any).settingsPath = path.join(testFilePath, 'impossible_subfolder/settings.json');

    // Attempting update must log error and keep in-memory state unmodified
    service.updateSetting('minimizeToTray', false);

    // Value should still be default true
    assert.strictEqual(service.getSettings().minimizeToTray, true);
  });

  it('11. returned settings snapshot cannot mutate internal state', () => {
    const service = new SettingsService(testFilePath);
    service.load();

    const snapshot = service.getSettings();

    // Attempting to mutate returned snapshot
    (snapshot as any).minimizeToTray = false;

    // Verify internal state remained unaffected (should still be true)
    assert.strictEqual(service.getSettings().minimizeToTray, true);
  });
});
