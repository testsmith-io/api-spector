// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { ElectronAPI } from '../../../preload/index';

declare global {
  const __APP_VERSION__: string;
  interface Window {
    electron: ElectronAPI;
  }
}
