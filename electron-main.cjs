const { app, BrowserWindow, dialog, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');

// Set production environment by default
process.env.NODE_ENV = 'production';

// Robust crash logging for debugging packaged app failures
function errorLogPath() {
  return path.join(app.getPath('userData'), 'uwrp-errors.log');
}

function logCrash(error, context = 'General') {
  try {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const logMessage = `[${new Date().toISOString()}] Crash in ${context}:\n${error.stack || error.toString()}\n\n`;
    fs.appendFileSync(path.join(userDataPath, 'crash.txt'), logMessage);
    fs.appendFileSync(errorLogPath(), logMessage);
    
    // Also show a GUI dialog box to notify the user
    dialog.showErrorBox('Application Crash', `A critical error occurred: ${error.message || error}\n\nTrace: ${error.stack || 'No stack trace'}`);
  } catch (logErr) {
    console.error('Failed to write crash log:', logErr);
  }
}

process.on('uncaughtException', (error) => {
  logCrash(error, 'Uncaught Exception');
  app.quit();
});

process.on('unhandledRejection', (reason) => {
  logCrash(reason instanceof Error ? reason : new Error(String(reason)), 'Unhandled Rejection');
  app.quit();
});

// Helper function to find a free TCP port dynamically
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', (err) => reject(err));
  });
}

let mainWindow = null;
let splashWindow = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    title: 'Starting Universal Warrant Return Parser',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Loading...</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            background: rgba(15, 23, 42, 0.96);
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            border-radius: 16px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.08);
            overflow: hidden;
          }
          .spinner {
            border: 4px solid rgba(99, 102, 241, 0.1);
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border-left-color: #6366f1;
            animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            margin-bottom: 24px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .title {
            font-size: 19px;
            font-weight: 800;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            color: #ffffff;
            margin-bottom: 6px;
          }
          .subtitle {
            font-size: 11px;
            color: #64748b;
            margin-bottom: 24px;
            font-weight: 600;
            letter-spacing: 0.025em;
          }
          .status {
            font-size: 11px;
            color: #818cf8;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            background: rgba(99, 102, 241, 0.08);
            padding: 6px 14px;
            border-radius: 20px;
            border: 1px solid rgba(99, 102, 241, 0.15);
            max-width: 80%;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <div class="title">Warrant Return Parser</div>
        <div class="subtitle">UNIVERSAL FORENSIC ANALYSIS SUITE</div>
        <div class="status" id="status">Starting startup tasks...</div>
      </body>
    </html>
  `)}`);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

async function startApp() {
  try {
    // 0. Show splash screen instantly
    createSplashWindow();

    // 1. Find a free port dynamically to prevent port conflicts
    if (splashWindow && !splashWindow.isDestroyed()) {
      await splashWindow.webContents.executeJavaScript('document.getElementById("status").innerText = "Reserving host network port...";').catch(() => {});
    }
    const port = await findFreePort();
    process.env.PORT = port.toString();

    // 2. Set database path to standard writable application directory
    if (splashWindow && !splashWindow.isDestroyed()) {
      await splashWindow.webContents.executeJavaScript('document.getElementById("status").innerText = "Opening SQLite database...";').catch(() => {});
    }
    const userDataPath = app.getPath('userData');
    process.env.DATABASE_PATH = path.join(userDataPath, 'database.sqlite');
    console.log(`[Electron] Starting backend database at: ${process.env.DATABASE_PATH}`);

    // 3. Start the Express server
    if (splashWindow && !splashWindow.isDestroyed()) {
      await splashWindow.webContents.executeJavaScript('document.getElementById("status").innerText = "Initializing backend server...";').catch(() => {});
    }
    
    // Give Electron time to repaint and show the splash screen before block-loading the module
    await new Promise(resolve => setTimeout(resolve, 400));
    
    require('./dist/server.cjs');
    console.log(`[Electron] Express server started on port ${port}`);

    // 4. Create the browser window
    if (splashWindow && !splashWindow.isDestroyed()) {
      await splashWindow.webContents.executeJavaScript('document.getElementById("status").innerText = "Loading user interface...";').catch(() => {});
    }
    createWindow(port);
  } catch (error) {
    logCrash(error, 'startApp');
    app.quit();
  }
}

function crashPageHtml(port, reason, logPath) {
  const safeReason = String(reason || 'unknown').replace(/[<>&]/g, '');
  const safeLog = String(logPath || '').replace(/[<>&]/g, '');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Parser stopped</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      background:#0f172a; color:#e2e8f0; font-family: Segoe UI, sans-serif; }
    main { max-width:560px; padding:24px; }
    h1 { font-size:22px; margin:8px 0 12px; }
    p { line-height:1.5; color:#cbd5e1; }
    button { background:#4f46e5; color:white; border:0; border-radius:8px; padding:10px 14px;
      font-weight:700; cursor:pointer; margin-right:8px; }
    code { color:#fbbf24; }
  </style></head><body><main>
    <p style="letter-spacing:.08em;font-size:12px;color:#fbbf24;font-weight:700;margin:0">WARRANT RETURN PARSER</p>
    <h1>The window stopped</h1>
    <p>The case view is not running. Windows can still call the program "responding" when this happens, which leaves a white window if nothing explains it.</p>
    <p>Reason: <code>${safeReason}</code></p>
    <p>A local log was written to<br><code>${safeLog}</code></p>
    <p>
      <button onclick="location.href='http://127.0.0.1:${port}/'">Reload window</button>
    </p>
    <p>After it reloads, open the last saved case. Records that were saved are restored without parsing the original return again. Media whose files are gone is shown as missing.</p>
  </main></body></html>`;
}

function showStoppedPage(port, reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const logPath = errorLogPath();
  const html = crashPageHtml(port, reason, logPath);
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
  if (!mainWindow.isVisible()) mainWindow.show();
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // Don't show until ready-to-show to prevent blank white screen
    title: 'Universal Warrant Return Parser',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'electron-preload.cjs'),
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Help',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Ctrl+Shift+I',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
          },
        },
        {
          label: 'Open Log Folder',
          click: () => {
            shell.openPath(path.dirname(errorLogPath()));
          },
        },
        {
          label: 'Reload Window',
          accelerator: 'Ctrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`http://127.0.0.1:${port}/`);
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Keep Help visible. The packaged app has no DevTools shortcut unless this menu exists.
  mainWindow.setAutoHideMenuBar(false);
  mainWindow.setMenuBarVisibility(true);

  // Load the backend server URL
  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    // Reveal main window and close splash screen
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const reason = details && details.reason ? details.reason : 'unknown';
    logCrash(new Error(`Renderer process gone (${reason})`), 'render-process-gone');
    if (reason === 'clean-exit') return;
    showStoppedPage(port, reason);
  });

  mainWindow.on('unresponsive', () => {
    logCrash(new Error('Renderer unresponsive'), 'unresponsive');
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Keep waiting', 'Reload window'],
      defaultId: 1,
      cancelId: 0,
      title: 'Window not responding',
      message: 'Universal Warrant Return Parser is not responding.',
      detail: 'You can keep waiting, or reload. A saved case opens from the database without parsing the original return again. Details are in uwrp-errors.log.',
    }).then((choice) => {
      if (choice.response === 1 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`http://127.0.0.1:${port}/`);
      }
    }).catch(() => {});
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    logCrash(new Error(`Failed to load window (${code}): ${description}`), 'did-fail-load');
  });
}

ipcMain.on('uwrp-open-log-folder', () => {
  shell.openPath(path.dirname(errorLogPath()));
});
ipcMain.on('uwrp-toggle-devtools', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
});
ipcMain.handle('uwrp-pick-save-zip', async (event, defaultName) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showSaveDialog(win, {
    title: 'Save portable case',
    defaultPath: String(defaultName || 'Portable_Case.zip'),
    filters: [{ name: 'Portable case', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return '';
  return result.filePath;
});
ipcMain.on('uwrp-reload-window', () => {
  if (mainWindow && !mainWindow.isDestroyed() && process.env.PORT) {
    mainWindow.loadURL(`http://127.0.0.1:${process.env.PORT}/`);
  }
});

// Single instance lock to prevent launching multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startApp);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && process.env.PORT) {
    createWindow(parseInt(process.env.PORT));
  }
});
