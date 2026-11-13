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
  openAppleImport(mode) { ipcRenderer.send('uwrp-open-apple-import', mode || ''); },
  openAppleFile(filePath) { ipcRenderer.send('uwrp-open-apple-file', String(filePath || '')); },
  openAppleFolder(dirPath) { ipcRenderer.send('uwrp-open-apple-folder', String(dirPath || '')); },
  openAppleBackups(root) { ipcRenderer.send('uwrp-open-apple-backups', root || ''); },
  openExternal(filePath) { ipcRenderer.send('uwrp-open-external', String(filePath || '')); },
  appleBackupSummary(roots) { return ipcRenderer.invoke('apple:backup-summary', roots || []); },
  hashFile(filePath) { return ipcRenderer.invoke('uwrp-hash-file', String(filePath || '')); },
  sendTagState(keys) { ipcRenderer.send('uwrp-tag-state', Array.isArray(keys) ? keys : []); },
  onBackupTags(fn) {
    const handler = (_event, data) => fn(data);
    ipcRenderer.on('uwrp-backup-tags', handler);
    return () => ipcRenderer.removeListener('uwrp-backup-tags', handler);
  },
  onAppleImportComplete(fn) {
    const handler = (_event, data) => fn(data);
    ipcRenderer.on('apple-import-complete', handler);
    return () => ipcRenderer.removeListener('apple-import-complete', handler);
  },
});
