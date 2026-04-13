// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { SentRequest } from '../../../../shared/types';

export function RequestPanel({ sentRequest }: { sentRequest: SentRequest | null }) {
  if (!sentRequest) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-xs">
        Send a request to see what was transmitted.
      </div>
    );
  }

  const hasBody = sentRequest.body !== undefined && sentRequest.body !== '';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto text-xs font-mono">
      {/* Request line */}
      <div className="px-4 py-3 border-b border-surface-800 flex items-center gap-3">
        <span className="font-bold text-blue-400 shrink-0">{sentRequest.method}</span>
        <span className="text-white break-all">{sentRequest.url}</span>
      </div>

      {/* Headers */}
      <div className="px-4 py-2 border-b border-surface-800">
        <p className="text-[10px] text-surface-400 uppercase tracking-wider font-medium mb-1.5">Headers</p>
        {Object.keys(sentRequest.headers).length === 0 ? (
          <span className="text-surface-600">No headers sent</span>
        ) : (
          <table className="w-full">
            <tbody>
              {Object.entries(sentRequest.headers).map(([k, v]) => (
                <tr key={k} className="border-b border-surface-800/50 last:border-0">
                  <td className="py-1 pr-4 text-surface-400 w-56 align-top">{k}</td>
                  <td className="py-1 text-white break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Body */}
      {hasBody && (
        <div className="px-4 py-2">
          <p className="text-[10px] text-surface-400 uppercase tracking-wider font-medium mb-1.5">Body</p>
          <pre className="text-white whitespace-pre-wrap break-all text-[11px]">{sentRequest.body}</pre>
        </div>
      )}
    </div>
  );
}
