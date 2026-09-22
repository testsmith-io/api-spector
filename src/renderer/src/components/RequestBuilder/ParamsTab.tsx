// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';
import type { ApiRequest } from '../../../../shared/types';
import { KVTable } from './KVTable';
import { useT } from '../../i18n';

export function ParamsTab({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const t = useT();
  return (
    <KVTable
      rows={request.params}
      onChange={rows => onChange({ params: rows })}
      keyPlaceholder={t('param')}
      valuePlaceholder={t('value')}
      paramMode
    />
  );
}
