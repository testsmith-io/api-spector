// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useRef, useState } from 'react';

// ─── Toast ────────────────────────────────────────────────────────────────────

export function useToast(durationMs = 3000) {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function show(msg: string, ok: boolean) {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, ok });
    timer.current = setTimeout(() => setToast(null), durationMs);
  }
  return { toast, show };
}

export function Toast({ toast }: { toast: { msg: string; ok: boolean } | null }) {
  if (!toast) return null;
  return (
    <div className={`mx-3 mb-2 px-2 py-1.5 rounded text-[11px] flex-shrink-0 ${
      toast.ok ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-800/50'
               : 'bg-red-900/50 text-red-300 border border-red-800/50'
    }`}>
      {toast.msg}
    </div>
  );
}
