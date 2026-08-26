import * as fs from 'fs';
import * as path from 'path';
import { WaveRPCSettings, DEFAULT_SETTINGS, Logger, TypedEventEmitter } from '@waverpc/shared';

const log = new Logger('SettingsService');

/**
 * WaveRPC Settings Service
 *
 * Consistency Model: Write-Through Persistence
 * In-memory settings are only updated AFTER the data has been successfully committed to disk
 * via an atomic write-and-replace operation. This guarantees that the in-memory state
 * never silently diverges from the persistent disk state.
 */
export class SettingsService {
  private settingsPath: string;
  private settings: WaveRPCSettings;
  private events?: TypedEventEmitter;

  constructor(customFilePath?: string, events?: TypedEventEmitter) {
    this.settings = { ...DEFAULT_SETTINGS };
    this.events = events;

    if (customFilePath) {
      this.settingsPath = customFilePath;
    } else {
      try {
        const { app } = require('electron');
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
      } catch (err) {
        log.warn('Failed to resolve Electron userData path, settings path not set:', err);
        this.settingsPath = '';
      }
    }
  }

  public getSettingsPath(): string {
    return this.settingsPath;
  }

  /**
   * Loads settings from the local file system.
   * If the file is missing, defaults are loaded.
   * If the file is malformed or invalid, defaults are loaded without overwriting the broken file on disk.
   */
  public load(): void {
    log.info('Loading settings from local storage...');
    if (!this.settingsPath) {
      log.warn('Settings path is not initialized. Using defaults.');
      this.settings = { ...DEFAULT_SETTINGS };
      return;
    }

    if (!fs.existsSync(this.settingsPath)) {
      log.info('Settings file not found. Using defaults.');
      this.settings = { ...DEFAULT_SETTINGS };
      return;
    }

    try {
      const rawData = fs.readFileSync(this.settingsPath, 'utf-8');
      const parsedData = JSON.parse(rawData);

      // Perform validation and merge with defaults
      this.settings = this.validateAndMerge(parsedData, DEFAULT_SETTINGS);
      log.info('Settings successfully loaded and merged.');
    } catch (err) {
      log.warn('Settings file is corrupt or invalid. Falling back to defaults.', err);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Returns a safe deep-copy clone of the current settings.
   */
  public getSettings(): WaveRPCSettings {
    return { ...this.settings };
  }

  /**
   * Updates a single setting key and persists it.
   * If persistence fails, the in-memory state remains unmodified.
   */
  public updateSetting<K extends keyof WaveRPCSettings>(
    key: K,
    value: WaveRPCSettings[K]
  ): boolean {
    if (typeof value !== 'boolean') {
      log.warn(`Invalid update ignored: value for key "${key}" must be a boolean.`);
      return false;
    }

    const nextSettings = { ...this.settings, [key]: value };
    const success = this.persist(nextSettings);
    if (success) {
      this.settings = nextSettings;
      log.info(`Updated setting: ${key} = ${value}`);
      if (this.events) {
        this.events.emit('settings:changed', this.getSettings());
      }
      return true;
    } else {
      log.error(`Failed to update setting: ${key}. In-memory state unchanged.`);
      return false;
    }
  }

  /**
   * Updates multiple settings and persists them.
   * If persistence fails, the in-memory state remains unmodified.
   */
  public updateSettings(partial: Partial<WaveRPCSettings>): boolean {
    const validatedPartial = this.validateAndMerge(partial, this.settings);
    const success = this.persist(validatedPartial);
    if (success) {
      this.settings = validatedPartial;
      log.info('Settings updated successfully.');
      if (this.events) {
        this.events.emit('settings:changed', this.getSettings());
      }
      return true;
    } else {
      log.error('Failed to update settings. In-memory state unchanged.');
      return false;
    }
  }

  /**
   * Validates parsed untrusted input and merges it with a base configuration.
   * If field types are invalid, they fall back to the base value.
   */
  private validateAndMerge(parsed: any, base: WaveRPCSettings): WaveRPCSettings {
    const result = { ...base };

    if (!parsed || typeof parsed !== 'object') {
      return result;
    }

    if (parsed.hasOwnProperty('minimizeToTray')) {
      if (typeof parsed.minimizeToTray === 'boolean') {
        result.minimizeToTray = parsed.minimizeToTray;
      } else {
        log.warn('Invalid type for minimizeToTray: must be boolean. Reverting to fallback.');
      }
    }

    if (parsed.hasOwnProperty('launchAtStartup')) {
      if (typeof parsed.launchAtStartup === 'boolean') {
        result.launchAtStartup = parsed.launchAtStartup;
      } else {
        log.warn('Invalid type for launchAtStartup: must be boolean. Reverting to fallback.');
      }
    }

    if (parsed.hasOwnProperty('startMinimized')) {
      if (typeof parsed.startMinimized === 'boolean') {
        result.startMinimized = parsed.startMinimized;
      } else {
        log.warn('Invalid type for startMinimized: must be boolean. Reverting to fallback.');
      }
    }

    return result;
  }

  /**
   * Persists settings to disk using a safe temporary file replacement strategy.
   * Returns true on success, false on failure.
   */
  private persist(data: WaveRPCSettings): boolean {
    if (!this.settingsPath) {
      log.error('Cannot persist settings: settings path is not initialized.');
      return false;
    }

    const dir = path.dirname(this.settingsPath);
    const tmpPath = `${this.settingsPath}.tmp`;

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write atomically to temporary file
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');

      // Perform atomic rename replacement
      fs.renameSync(tmpPath, this.settingsPath);
      return true;
    } catch (err) {
      log.error('Persistence failed during settings write-out:', err);

      // Clean up temporary file if left behind
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {}

      return false;
    }
  }
}
