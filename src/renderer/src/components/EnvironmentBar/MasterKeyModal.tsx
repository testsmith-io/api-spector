import React, { useState } from 'react';

const { electron } = window;

const EXAMPLES = [
  {
    label: 'macOS / Linux  (~/.zshrc or ~/.bashrc)',
    code: (pw: string) => `export API_SPECTOR_MASTER_KEY="${pw || '<your-password>'}"`,
  },
  {
    label: 'Windows — PowerShell profile',
    code: (pw: string) => `$env:API_SPECTOR_MASTER_KEY = "${pw || '<your-password>'}"`,
  },
  {
    label: 'Windows — Command Prompt (permanent)',
    code: (pw: string) => `setx API_SPECTOR_MASTER_KEY "${pw || '<your-password>'}"`,
  },
];

interface Props {
  onSuccess: (password: string) => void
  onCancel: () => void
}

export function MasterKeyModal({ onSuccess, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<number | null>(null);

  async function confirm() {
    if (!password.trim()) {
      setError('Password cannot be empty.');
      return;
    }
    await electron.setMasterKey(password);
    onSuccess(password);
  }

  function copy(idx: number, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl w-[500px] p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-semibold">Master Password Required</h3>
          <p className="text-xs text-surface-400 mt-1">
            Secrets are encrypted with AES-256-GCM using a master password. Set{' '}
            <code className="text-surface-200 bg-surface-800 px-1 rounded">API_SPECTOR_MASTER_KEY</code>{' '}
            in your shell profile to persist it across sessions.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-surface-400 uppercase tracking-wider font-medium">
            Master Password
          </label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && confirm()}
            placeholder="Enter master password…"
            className="bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-surface-400 uppercase tracking-wider font-medium">
            Add to your shell profile
          </p>
          {EXAMPLES.map((ex, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <span className="text-[10px] text-surface-400">{ex.label}</span>
              <div className="flex items-center gap-2 bg-surface-800 rounded px-3 py-1.5">
                <code className="flex-1 text-[11px] text-surface-200 font-mono truncate">
                  {ex.code(password)}
                </code>
                <button
                  onClick={() => copy(idx, ex.code(password))}
                  className="text-[10px] text-surface-400 hover:text-white transition-colors shrink-0"
                >
                  {copied === idx ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-surface-400 hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!password.trim()}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded transition-colors"
          >
            Set Password &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}
