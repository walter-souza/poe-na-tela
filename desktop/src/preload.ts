import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon?: string | null;
  display_id?: string;
}

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  getSources: async (): Promise<DesktopSource[]> => {
    return await ipcRenderer.invoke('desktop:get-sources');
  },
  minimize: () => {
    ipcRenderer.send('window:minimize');
  },
  maximize: () => {
    ipcRenderer.send('window:maximize');
  },
  close: () => {
    ipcRenderer.send('window:close');
  },
  setPriority: (priority: 'high' | 'realtime' | 'normal') => {
    return ipcRenderer.invoke('process:set-priority', priority);
  },
  registerShortcut: (shortcut: string, actionName: string) => {
    return ipcRenderer.invoke('shortcut:register', shortcut, actionName);
  },
  onShortcut: (callback: (action: string) => void) => {
    const listener = (_event: any, action: string) => callback(action);
    ipcRenderer.on('shortcut:triggered', listener);
    return () => {
      ipcRenderer.removeListener('shortcut:triggered', listener);
    };
  },
});
