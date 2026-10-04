import { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut } from 'electron';
import * as path from 'path';
import * as os from 'os';

// 1. Enable ultra-high-performance GPU flags and eliminate background throttling
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force-high-performance-gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,WindowsGraphicsCapture');

// Set Process Priority to HIGH on Windows to prevent game focus from starving WebRTC capture
try {
  if (process.platform === 'win32') {
    os.setPriority(os.constants.priority.PRIORITY_HIGH);
    console.log('Successfully set Windows process priority to HIGH for smooth 60 FPS streaming.');
  }
} catch (e) {
  console.warn('Could not set process priority:', e);
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0c0e14',
    title: 'Põe na Tela — Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // Prevents throttling when minimized or unfocused
      webSecurity: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      // If dev server not yet ready, retry shortly
      setTimeout(() => {
        mainWindow?.loadURL(devUrl);
      }, 1500);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../client/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  // IPC Handlers for Screen and Window capture sources
  ipcMain.handle('desktop:get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
      });

      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
        display_id: source.display_id,
      }));
    } catch (err) {
      console.error('Failed to get desktop sources:', err);
      return [];
    }
  });

  // Process Priority IPC
  ipcMain.handle('process:set-priority', (_event, priority: 'high' | 'realtime' | 'normal') => {
    try {
      if (process.platform === 'win32') {
        const pLevel =
          priority === 'realtime'
            ? os.constants.priority.PRIORITY_HIGHEST
            : priority === 'high'
            ? os.constants.priority.PRIORITY_HIGH
            : os.constants.priority.PRIORITY_NORMAL;
        os.setPriority(pLevel);
        return true;
      }
    } catch (e) {
      console.error('Failed to set priority:', e);
    }
    return false;
  });

  // Window Controls
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  // Global Shortcuts (e.g. Mute / Deafen / Push-to-Talk)
  ipcMain.handle('shortcut:register', (_event, shortcut: string, actionName: string) => {
    try {
      return globalShortcut.register(shortcut, () => {
        mainWindow?.webContents.send('shortcut:triggered', actionName);
      });
    } catch (e) {
      console.error(`Failed to register shortcut ${shortcut}:`, e);
      return false;
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
