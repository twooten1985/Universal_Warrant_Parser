const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('forensicDesktop', {
  getPathForFile(file) {
    try {
      if (!file) return '';
      return webUtils.getPathForFile(file) || '';
    } catch (err) {
      console.error('getPathForFile failed:', err);
      return '';
    }
  },
  openLogFolder() {
    ipcRenderer.send('uwrp-open-log-folder');
  },
  toggleDevTools() {
    ipcRenderer.send('uwrp-toggle-devtools');
  },
  reloadWindow() {
    ipcRenderer.send('uwrp-reload-window');
  },
  pickSaveZip(defaultName) {
    return ipcRenderer.invoke('uwrp-pick-save-zip', defaultName || 'Portable_Case.zip');
  },
});
