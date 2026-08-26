export interface WaveRPCSettings {
  minimizeToTray: boolean;
  launchAtStartup: boolean;
  startMinimized: boolean;
}

export const DEFAULT_SETTINGS: WaveRPCSettings = {
  minimizeToTray: true,
  launchAtStartup: false,
  startMinimized: false,
};
