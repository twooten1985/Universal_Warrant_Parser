/// <reference types="vite/client" />

interface ForensicDesktopApi {
  getPathForFile?: (file: File) => string;
  openLogFolder?: () => void;
  toggleDevTools?: () => void;
  reloadWindow?: () => void;
  pickSaveZip?: (defaultName?: string) => Promise<string>;
  openAppleImport?: (mode?: 'folder' | '') => void;
  openAppleFile?: (filePath: string) => void;
  openAppleFolder?: (dirPath: string) => void;
  openAppleBackups?: (root?: string) => void;
  openExternal?: (filePath: string) => void;
  appleBackupSummary?: (roots: string[]) => Promise<{ backups: any[]; events: any[] }>;
  hashFile?: (filePath: string) => Promise<string>;
  sendTagState?: (keys: string[]) => void;
  onBackupTags?: (fn: (data: { items: Array<{ key: string; meta?: Record<string, unknown> }>; tagged: boolean }) => void) => () => void;
  onAppleImportComplete?: (fn: (data: { outDir: string; roots: { extracted: string | string[]; derived: string }; accounts: unknown[]; backups: number }) => void) => () => void;
}

interface Window {
  forensicDesktop?: ForensicDesktopApi;
}
