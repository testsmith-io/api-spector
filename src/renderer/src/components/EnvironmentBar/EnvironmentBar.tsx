// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import { useStore } from '../../store';
import { useActiveEnvironment } from '../../hooks/useActiveEnvironment';
import { EnvironmentEditor } from './EnvironmentEditor';
import { MasterKeyModal } from './MasterKeyModal';
import { useT } from '../../i18n';

const { electron } = window;

export function EnvironmentBar({ inline = false }: { inline?: boolean }) {
  const t = useT();
  const environments = useStore(s => s.environments);
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const setActiveEnvironment = useStore(s => s.setActiveEnvironment);
  const [showEditor, setShowEditor] = useState(false);
  const [pendingEnvId, setPendingEnvId] = useState<string | null>(null);

  const defaultEnvName = useStore(s => s.workspace?.settings?.defaultEnvironment);

  const envList = Object.values(environments);
  // Resolved through the extends chain so the var count includes inherited vars.
  const activeEnv = useActiveEnvironment();
  const varCount = activeEnv?.variables.filter(v => v.enabled).length ?? 0;

  async function handleEnvChange(id: string | null) {
    if (id) {
      const hasSecrets = environments[id]?.data.variables.some(v => v.enabled && v.secret);
      if (hasSecrets) {
        const { set } = await electron.checkMasterKey();
        if (!set) {
          setPendingEnvId(id);
          return;
        }
      }
    }
    setActiveEnvironment(id);
  }

  const controls = (
    <>
      {pendingEnvId !== null && (
        <MasterKeyModal
          onSuccess={() => {
            setActiveEnvironment(pendingEnvId);
            setPendingEnvId(null);
          }}
          onCancel={() => setPendingEnvId(null)}
        />
      )}

      <select
        value={activeEnvironmentId ?? ''}
        onChange={e => handleEnvChange(e.target.value || null)}
        className="bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-500 max-w-[140px]"
        style={{ color: 'var(--text-primary)' }}
      >
        <option value="">{t('No env')}</option>
        {envList.map(({ data: env }) => (
          <option key={env.id} value={env.id}>
            {defaultEnvName && env.name.toLowerCase() === defaultEnvName.toLowerCase()
              ? t(':name (default)', { name: env.name })
              : env.name}
          </option>
        ))}
      </select>

      {activeEnv && (
        <span className="text-surface-400 text-xs">
          {t(':count var|:count vars', { count: varCount })}
        </span>
      )}

      <button
        data-tour="environment-bar"
        onClick={() => setShowEditor(true)}
        className="text-blue-400 hover:text-blue-300 transition-colors text-xs"
      >
        {activeEnv ? t('Edit') : t('Manage')}
      </button>

      {showEditor && <EnvironmentEditor onClose={() => setShowEditor(false)} />}
    </>
  );

  if (inline) return <>{controls}</>;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-800 bg-surface-950 flex-shrink-0">
      <span className="text-surface-400 font-medium text-xs">{t('Env:')}</span>
      {controls}
    </div>
  );
}
