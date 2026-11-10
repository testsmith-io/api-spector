// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { KeyboardEvent } from 'react';

/** Enter/Space activation for a button-like non-native element; pair with
 *  `role="button"` + `tabIndex={0}` and the same handler as onClick. */
export function onActivateKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  };
}
