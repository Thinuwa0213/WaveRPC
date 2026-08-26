import { app, ipcMain } from 'electron';
import { WaveRPCDesktopApp } from './index.js';
import { MainWindow } from '../window/main-window.js';
import { WaveRPCTray } from '../tray/tray.js';
import { Logger, WaveRPCStatus } from '@waverpc/shared';
import { resolveAppVersion } from './app-version.js';

const log = new Logger('ElectronApp');

export class ElectronApp {
  private runtimeApp: WaveRPCDesktopApp | null = null;
  private mainWindow: MainWindow | null = null;
  private tray: WaveRPCTray | null = null;
  private isQuitting = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor() {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      log.info('Another instance of WaveRPC is already running. Quitting.');
      app.quit();
      return;
    }

    this.setupAppLifecycle();
  }

  private setupAppLifecycle(): void {
    app.on('second-instance', () => {
      log.info('Second instance detected. Focusing existing window.');
      this.showMainWindow();
    });

    app.whenReady().then(async () => {
      log.info('Electron app ready. Starting services...');

      // Initialize runtime services
      this.runtimeApp = new WaveRPCDesktopApp();
      try {
        await this.runtimeApp.bootstrap();

        // Reconcile persisted launchAtStartup setting with OS startup registry
        const settings = this.runtimeApp.getSettingsService().getSettings();
        if (app.isPackaged) {
          try {
            const currentSettings = app.getLoginItemSettings({ path: process.execPath });
            if (currentSettings.openAtLogin !== settings.launchAtStartup) {
              app.setLoginItemSettings({
                openAtLogin: settings.launchAtStartup,
                path: process.execPath,
              });
              log.info(
                `Reconciled launchAtStartup OS state to match settings: ${settings.launchAtStartup}`
              );
            }
          } catch (err) {
            log.error('Failed to reconcile login item settings during startup:', err);
          }
        } else {
          log.info(
            `[Startup] launchAtStartup preference saved; OS registration skipped in development mode. (value: ${settings.launchAtStartup})`
          );
        }
      } catch (err) {
        log.error('Failed to bootstrap WaveRPC Desktop runtime:', err);
      }

      // Handle safe version request from preload without hardcoding
      ipcMain.handle('get-app-info', () => {
        return {
          name: 'WaveRPC',
          version: resolveAppVersion(),
        };
      });

      ipcMain.handle('get-status', () => {
        return this.runtimeApp?.getStatusService().getStatus();
      });

      ipcMain.handle('get-settings', () => {
        return this.runtimeApp?.getSettingsService().getSettings();
      });

      ipcMain.handle('update-setting', async (_event, arg: { key: string; value: any }) => {
        if (!this.runtimeApp) {
          return { success: false };
        }

        const { key, value } = arg || {};

        // Authoritative main process validation
        if (key !== 'minimizeToTray' && key !== 'launchAtStartup' && key !== 'startMinimized') {
          log.warn(`Rejected invalid settings update key: ${key}`);
          return { success: false };
        }

        if (typeof value !== 'boolean') {
          log.warn(
            `Rejected invalid settings update type for key "${key}": expected boolean, got ${typeof value}`
          );
          return { success: false };
        }

        // OS Startup registration validation
        if (key === 'launchAtStartup') {
          if (app.isPackaged) {
            try {
              app.setLoginItemSettings({
                openAtLogin: value,
                path: process.execPath,
              });
              log.info(`launchAtStartup OS state successfully applied: ${value}`);
            } catch (err) {
              log.error('Failed to set login item settings:', err);
              return { success: false };
            }
          } else {
            log.info(
              `[Startup] launchAtStartup preference saved; OS registration skipped in development mode. (value: ${value})`
            );
          }
        }

        const service = this.runtimeApp.getSettingsService();
        const success = service.updateSetting(key, value);
        return { success };
      });

      // Create window and system tray
      const events = this.runtimeApp.getEvents();
      this.mainWindow = new MainWindow(this, events);
      this.tray = new WaveRPCTray(this, events);
    });

    app.on('window-all-closed', () => {
      // Do nothing since we hide to tray or handle it in close handler
    });

    app.on('before-quit', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.requestQuit();
      }
    });
  }

  public async requestQuit(): Promise<void> {
    if (this.isQuitting && this.shutdownPromise) {
      await this.shutdownPromise;
      return;
    }

    this.isQuitting = true;
    log.info('Commencing canonical quit and clean shutdown of WaveRPC runtime...');

    if (!this.shutdownPromise) {
      this.shutdownPromise = (async () => {
        try {
          if (this.mainWindow) {
            this.mainWindow.destroy();
            this.mainWindow = null;
          }
          if (this.tray) {
            this.tray.destroy();
            this.tray = null;
          }
          if (this.runtimeApp) {
            await this.runtimeApp.shutdown();
            this.runtimeApp = null;
          }
        } catch (err) {
          log.error('Error during shutdown:', err);
        }
      })();
    }

    await this.shutdownPromise;
    log.info('Shutdown complete. Exiting process.');
    app.quit();
  }

  public getQuittingFlag(): boolean {
    return this.isQuitting;
  }

  public getStatus(): WaveRPCStatus | undefined {
    return this.runtimeApp?.getStatusService().getStatus();
  }

  public getSettingsService() {
    return this.runtimeApp?.getSettingsService();
  }

  public showMainWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.show();
    }
  }

  public quitApp(): void {
    this.requestQuit();
  }
}
