// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { KeyboardEvent } from 'react';

/**
 * Keyboard activation for a non-native element that behaves like a button.
 * Pair with `role="button"` + `tabIndex={0}` and the same handler as onClick,
 * so Enter/Space activate it like a real button (a11y: keyboard parity).
 */
export function onActivateKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  };
}
