import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('waverpc', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  onStatusChanged: (callback: (status: any) => void) => {
    const subscription = (_event: IpcRendererEvent, status: any) => callback(status);
    ipcRenderer.on('status-changed', subscription);
    return () => {
      ipcRenderer.removeListener('status-changed', subscription);
    };
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSetting: (key: string, value: boolean) =>
    ipcRenderer.invoke('update-setting', { key, value }),
  onSettingsChanged: (callback: (settings: any) => void) => {
    const subscription = (_event: IpcRendererEvent, settings: any) => callback(settings);
    ipcRenderer.on('settings-changed', subscription);
    return () => {
      ipcRenderer.removeListener('settings-changed', subscription);
    };
  },
});
