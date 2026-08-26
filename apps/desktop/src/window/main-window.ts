import { BrowserWindow, app, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ElectronApp } from '../main/electron-app.js';
import { Logger, TypedEventEmitter } from '@waverpc/shared';

const log = new Logger('MainWindow');

export class MainWindow {
  private window: BrowserWindow | null = null;
  private unsubscribes: Array<() => void> = [];

  constructor(
    private appCoordinator: ElectronApp,
    private events: TypedEventEmitter
  ) {
    this.createWindow();
    this.setupListeners();
  }

  private createWindow(): void {
    const preloadPath = path.join(__dirname, '../preload/index.js');
    const htmlPath = path.join(__dirname, '../renderer/index.html');

    log.info(`Creating main window. Preload path: ${preloadPath}`);

    const windowIconPath = path.join(app.getAppPath(), 'assets/icon.png');
    let windowIcon;
    if (fs.existsSync(windowIconPath)) {
      windowIcon = nativeImage.createFromPath(windowIconPath);
      log.info(`Loading main window icon from: ${windowIconPath}`);
    } else {
      log.warn(`Main window icon not found at ${windowIconPath}.`);
    }

    const settings = this.appCoordinator.getSettingsService()?.getSettings();
    const showWindow = settings ? !settings.startMinimized : true;

    this.window = new BrowserWindow({
      width: 900,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      backgroundColor: '#121214',
      show: showWindow,
      title: 'WaveRPC',
      icon: windowIcon,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: preloadPath,
      },
    });

    // Remove default menu for a cleaner dark shell look
    this.window.setMenu(null);

    this.window.loadURL(`file://${htmlPath}`).catch((err) => {
      log.error('Failed to load local HTML file:', err);
    });

    this.window.on('close', (event) => {
      if (this.appCoordinator.getQuittingFlag()) {
        return;
      }

      const currentSettings = this.appCoordinator.getSettingsService()?.getSettings();
      if (currentSettings?.minimizeToTray) {
        event.preventDefault();
        if (this.window) {
          this.window.hide();
          log.info('Window hidden to system tray.');
        }
      } else {
        event.preventDefault();
        if (this.window) {
          this.window.hide();
        }
        this.appCoordinator.quitApp();
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });
  }

  public show(): void {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.show();
      this.window.focus();
    }
  }

  private setupListeners(): void {
    const unsubStatus = this.events.on('status:changed', (status) => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('status-changed', status);
      }
    });
    this.unsubscribes.push(unsubStatus);

    const unsubSettings = this.events.on('settings:changed', (settings) => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('settings-changed', settings);
      }
    });
    this.unsubscribes.push(unsubSettings);
  }

  public destroy(): void {
    // Safely remove listeners to prevent memory leak and duplicate events
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];

    if (this.window) {
      log.info('Destroying main window.');
      this.window.destroy();
      this.window = null;
    }
  }
}
