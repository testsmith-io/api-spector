// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ElectronAPI } from '../../../preload/index';

declare global {
  const __APP_VERSION__: string;
  interface Window {
    electron: ElectronAPI;
  }
}
