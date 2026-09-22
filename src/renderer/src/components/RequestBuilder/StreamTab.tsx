// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { useT } from '../../i18n';

// Per-request limits for streamed responses (SSE / NDJSON / chunked). Values are
// entered in seconds and stored as milliseconds on `request.stream`. Leaving a
// field blank uses the default; 0 disables that cap.
const DEFAULTS = { idleSec: 60, totalSec: 300 };

export function StreamTab({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const t = useT();
  const stream = request.stream ?? {};

  function setField(key: 'idleMs' | 'maxMs', seconds: string) {
    const next = { ...stream };
    if (seconds.trim() === '') {
      delete next[key];
    } else {
      const n = Number(seconds);
      if (Number.isNaN(n) || n < 0) return;
      next[key] = Math.round(n * 1000);
    }
    onChange({ stream: Object.keys(next).length ? next : undefined });
  }

  const toSec = (ms?: number) => (ms === undefined ? '' : String(ms / 1000));

  return (
    <div className="flex flex-col gap-4 p-1 text-xs max-w-md">
      <p className="text-surface-400 leading-relaxed">
        {t('Applies when the response is a stream (')}<span className="font-mono">text/event-stream</span>{t(', NDJSON, or chunked). A stream stays open until the server ends it, you hit Stop, or one of these limits trips. Leave blank for the default; set 0 to disable.')}
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-surface-300 font-medium">{t('Idle timeout (seconds)')}</span>
        <input
          type="number"
          min={0}
          value={toSec(stream.idleMs)}
          onChange={e => setField('idleMs', e.target.value)}
          placeholder={t(':value (default)', { value: DEFAULTS.idleSec })}
          className="w-40 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 placeholder-surface-600"
        />
        <span className="text-[11px] text-surface-500">{t('Close if no frame arrives for this long.')}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-surface-300 font-medium">{t('Max duration (seconds)')}</span>
        <input
          type="number"
          min={0}
          value={toSec(stream.maxMs)}
          onChange={e => setField('maxMs', e.target.value)}
          placeholder={t(':value (default)', { value: DEFAULTS.totalSec })}
          className="w-40 bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 placeholder-surface-600"
        />
        <span className="text-[11px] text-surface-500">{t('Total wall-clock cap for the whole stream.')}</span>
      </label>

      <p className="text-[11px] text-surface-500">
        {t('When a limit trips, the stream ends with status')} <span className="text-amber-400">{t('timed out')}</span>{' '}
        {t('and keeps whatever frames arrived. There is also a hard cap of 5000 events.')}
      </p>
    </div>
  );
}
