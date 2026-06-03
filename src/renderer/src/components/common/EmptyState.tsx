// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-surface-400 text-xs">
      {message}
    </div>
  );
}
