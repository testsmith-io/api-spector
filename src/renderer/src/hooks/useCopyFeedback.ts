// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from 'react';

/** How long a "✓ Copied" affordance stays lit after a copy. */
export const COPY_FEEDBACK_MS = 2000;

/**
 * Copy text to the clipboard and flash a transient "copied" marker. Handles the
 * repeated "writeText → set flag → clear after timeout" pattern.
 *
 * `copied` is the key of the last-copied item (pass a key to `copy` when a view
 * has several copy buttons), or `true` for a single button. It resets to null
 * after `resetMs`. Clipboard failures are swallowed (blocked / insecure origin).
 */
export function useCopyFeedback<K = boolean>(resetMs: number = COPY_FEEDBACK_MS) {
  const [copied, setCopied] = useState<K | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string, key?: K) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied((key ?? true) as K);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), resetMs);
    } catch { /* clipboard blocked / insecure origin */ }
  }, [resetMs]);

  return { copied, copy };
}
