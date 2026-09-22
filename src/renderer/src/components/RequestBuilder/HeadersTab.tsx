// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { KVTable } from './KVTable';
import { useT } from '../../i18n';

export function HeadersTab({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const t = useT();
  return (
    <KVTable
      rows={request.headers}
      onChange={rows => onChange({ headers: rows })}
      keyPlaceholder={t('Header-Name')}
      valuePlaceholder={t('value')}
      headerMode
    />
  );
}
