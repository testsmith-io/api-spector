// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import React, { useState } from 'react';
import { useStore } from '../../store';
import { EnvironmentEditor } from './EnvironmentEditor';
import { MasterKeyModal } from './MasterKeyModal';

const { electron } = window;

export function EnvironmentBar({ inline = false }: { inline?: boolean }) {
  const environments = useStore(s => s.environments);
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const setActiveEnvironment = useStore(s => s.setActiveEnvironment);
  const [showEditor, setShowEditor] = useState(false);
  const [pendingEnvId, setPendingEnvId] = useState<string | null>(null);

  const envList = Object.values(environments);
  const activeEnv = activeEnvironmentId ? environments[activeEnvironmentId]?.data : null;
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
        <option value="">No env</option>
        {envList.map(({ data: env }) => (
          <option key={env.id} value={env.id}>{env.name}</option>
        ))}
      </select>

      {activeEnv && (
        <span className="text-surface-400 text-xs">
          {varCount} var{varCount !== 1 ? 's' : ''}
        </span>
      )}

      <button
        onClick={() => setShowEditor(true)}
        className="text-blue-400 hover:text-blue-300 transition-colors text-xs"
      >
        {activeEnv ? 'Edit' : 'Manage'}
      </button>

      {showEditor && <EnvironmentEditor onClose={() => setShowEditor(false)} />}
    </>
  );

  if (inline) return <>{controls}</>;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-800 bg-surface-950 flex-shrink-0">
      <span className="text-surface-400 font-medium text-xs">Env:</span>
      {controls}
    </div>
  );
}
