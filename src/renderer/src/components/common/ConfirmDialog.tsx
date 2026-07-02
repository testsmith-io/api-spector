// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { Modal } from './Modal';

// ─── Confirm dialog ───────────────────────────────────────────────────────────

export function ConfirmDialog ( { message, onConfirm, onCancel }: {
  message: string
  onConfirm: () => void
  onCancel: () => void
} ) {
  return (
    <Modal
      onClose={onCancel}
      overlayClassName="bg-black/50 z-[300] flex items-center justify-center"
      panelClassName="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-4 w-72 flex flex-col gap-4"
    >
      <p className="text-sm text-white">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-surface-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors"
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}
