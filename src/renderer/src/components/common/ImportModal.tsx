import { useRef, useState } from 'react';
import type { Collection } from '../../../../shared/types';

const { electron } = window;

interface Props {
  onImport: (col: Collection | null) => void
  onClose: () => void
}

interface ImportOption {
  id: string
  label: string
  description: string
  supportsUrl?: boolean
}

const OPTIONS: ImportOption[] = [
  { id: 'postman',  label: 'Postman',  description: 'Collection v2.1 JSON' },
  { id: 'openapi',  label: 'OpenAPI',  description: 'JSON or YAML (v3.x)', supportsUrl: true },
  { id: 'insomnia', label: 'Insomnia', description: 'Export v4 JSON' },
  { id: 'bruno',    label: 'Bruno',    description: 'bruno.json collection file' },
];

export function ImportModal({ onImport, onClose }: Props) {
  const [selected, setSelected]   = useState<string | null>(null);
  const [url, setUrl]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const urlInputRef               = useRef<HTMLInputElement>(null);

  async function runImport(opt: ImportOption) {
    setLoading(true);
    setError(null);
    try {
      let col: Collection | null = null;
      if (opt.id === 'postman')  col = await electron.importPostman();
      if (opt.id === 'openapi')  col = await electron.importOpenApi();
      if (opt.id === 'insomnia') col = await electron.importInsomnia();
      if (opt.id === 'bruno')    col = await electron.importBruno();
      onImport(col);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function importFromUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const col = await electron.importOpenApiFromUrl(trimmed);
      onImport(col);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[420px] p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-100">Import Collection</h2>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Format cards */}
        <div className="grid grid-cols-2 gap-2">
          {OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setSelected(selected === opt.id ? null : opt.id)}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selected === opt.id
                  ? 'border-blue-500 bg-blue-950/50 text-blue-200'
                  : 'border-surface-700 bg-surface-800 hover:bg-surface-750 text-surface-300'
              }`}
            >
              <div className="text-xs font-semibold">{opt.label}</div>
              <div className="text-[10px] text-surface-500 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>

        {/* OpenAPI URL input (shown only when OpenAPI selected) */}
        {selected === 'openapi' && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Or import from URL</p>
            <div className="flex gap-2">
              <input
                ref={urlInputRef}
                value={url}
                onChange={e => { setUrl(e.target.value); setError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') importFromUrl(); }}
                placeholder="https://api.example.com/openapi.json"
                className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
              />
              <button
                onClick={importFromUrl}
                disabled={!url.trim() || loading}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors whitespace-nowrap"
              >
                {loading ? 'Fetching…' : 'From URL'}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-[11px] text-red-400">{error}</p>}

        {/* Action row */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!selected || loading}
            onClick={() => {
              const opt = OPTIONS.find(o => o.id === selected);
              if (opt) runImport(opt);
            }}
            className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors"
          >
            {loading ? 'Importing…' : 'Choose File'}
          </button>
        </div>
      </div>
    </div>
  );
}
