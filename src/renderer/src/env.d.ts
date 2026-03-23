import type { ElectronAPI } from '../../../preload/index';

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
