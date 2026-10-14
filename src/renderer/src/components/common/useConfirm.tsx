// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useCallback, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Reusable confirmation gate for destructive actions. Keeps the pending message
 * + action in local state and renders a styled ConfirmDialog, so every delete
 * flow gets the same "Are you sure?" dialog instead of ad-hoc / missing ones.
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   <button onClick={() => confirm(t('Delete X?'), () => doDelete())}>Delete</button>
 *   {dialog}
 */
export function useConfirm() {
  const [pending, setPending] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const confirm = useCallback((message: string, onConfirm: () => void) => {
    setPending({ message, onConfirm });
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      message={pending.message}
      onConfirm={() => { pending.onConfirm(); setPending(null); }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { confirm, dialog };
}
