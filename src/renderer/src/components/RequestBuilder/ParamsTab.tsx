import React from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { KVTable } from './KVTable';

export function ParamsTab({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  return (
    <KVTable
      rows={request.params}
      onChange={rows => onChange({ params: rows })}
      keyPlaceholder="param"
      valuePlaceholder="value"
    />
  );
}
