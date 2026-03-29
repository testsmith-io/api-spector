// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { KVTable } from './KVTable';

export function HeadersTab({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  return (
    <KVTable
      rows={request.headers}
      onChange={rows => onChange({ headers: rows })}
      keyPlaceholder="Header-Name"
      valuePlaceholder="value"
    />
  );
}
