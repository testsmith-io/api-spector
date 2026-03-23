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
