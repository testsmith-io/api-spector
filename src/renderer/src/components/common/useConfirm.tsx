// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useCallback, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/** Confirmation gate for destructive actions: holds the pending message + action and renders a ConfirmDialog. */
export function useConfirm() {
  const [pending, setPending] = useState<{ message: string; onConfirm: () => void; confirmLabel?: string } | null>(null);

  const confirm = useCallback((message: string, onConfirm: () => void, confirmLabel?: string) => {
    setPending({ message, onConfirm, confirmLabel });
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      onConfirm={() => { pending.onConfirm(); setPending(null); }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { confirm, dialog };
}
