/// <reference types="vite/client" />

interface ForensicDesktopApi {
  getPathForFile?: (file: File) => string;
  openLogFolder?: () => void;
  toggleDevTools?: () => void;
  reloadWindow?: () => void;
  pickSaveZip?: (defaultName?: string) => Promise<string>;
}

interface Window {
  forensicDesktop?: ForensicDesktopApi;
}
