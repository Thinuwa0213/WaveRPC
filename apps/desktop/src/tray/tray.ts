import { Tray, Menu, app, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ElectronApp } from '../main/electron-app.js';
import { Logger, TypedEventEmitter, WaveRPCStatus } from '@waverpc/shared';

const log = new Logger('Tray');

export class WaveRPCTray {
  private tray: Tray | null = null;
  private lastDisplayedStatusStr: string = '';

  private statusHandler = (status: WaveRPCStatus) => {
    this.updateTrayMenu(status);
  };

  constructor(
    private appCoordinator: ElectronApp,
    private events: TypedEventEmitter
  ) {
    this.initializeTray();
    this.setupStatusListener();
  }

  private initializeTray(): void {
    const iconPath = path.join(app.getAppPath(), 'assets/tray-icon.png');
    let trayIcon;

    if (fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
      log.info(`Loading system tray icon from: ${iconPath}`);
    } else {
      log.warn(`Local tray icon not found at ${iconPath}. Falling back gracefully.`);
      trayIcon = nativeImage.createEmpty();
    }

    if (!app.isPackaged) {
      log.info(`[DEV] Resolved system tray icon path: ${iconPath}`);
    }

    try {
      this.tray = new Tray(trayIcon);
      this.tray.setToolTip('WaveRPC');

      const initialStatus = this.appCoordinator.getStatus();
      this.updateTrayMenu(initialStatus);

      this.tray.on('click', () => {
        this.appCoordinator.showMainWindow();
      });

      this.tray.on('double-click', () => {
        this.appCoordinator.showMainWindow();
      });
    } catch (err) {
      log.error('Failed to instantiate system tray:', err);
    }
  }

  private setupStatusListener(): void {
    this.events.on('status:changed', this.statusHandler);
  }

  private updateTrayMenu(status?: WaveRPCStatus): void {
    if (!this.tray) return;

    let statusLabel = 'Status: WaveRPC Running';
    if (status) {
      const discordStr = status.discord.connected ? 'Connected' : 'Disconnected';
      const extensionStr = status.extension.connected ? 'Connected' : 'Waiting';
      statusLabel = `Discord: ${discordStr} | Extension: ${extensionStr}`;
    }

    if (statusLabel === this.lastDisplayedStatusStr) {
      return;
    }
    this.lastDisplayedStatusStr = statusLabel;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open WaveRPC',
        click: () => {
          this.appCoordinator.showMainWindow();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit WaveRPC',
        click: () => {
          this.appCoordinator.quitApp();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public destroy(): void {
    this.events.off('status:changed', this.statusHandler);
    if (this.tray) {
      log.info('Destroying system tray.');
      this.tray.destroy();
      this.tray = null;
    }
  }
}
