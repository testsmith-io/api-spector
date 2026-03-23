import React, { useState } from 'react'
import { useStore } from '../../store'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'

const { electron } = window as any

interface Props {
  onClose: () => void
}

export function DocsGeneratorModal({ onClose }: Props) {
  const collections = useStore(s => s.collections)

  const collectionList = Object.values(collections)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(collectionList.map(c => c.data.id)),
  )
  const [format, setFormat] = useState<'markdown' | 'html'>('markdown')
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggleCollection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function buildPayload() {
    return {
      collections: collectionList
        .filter(c => selectedIds.has(c.data.id))
        .map(c => ({ collection: c.data, requests: c.data.requests })),
      format,
    }
  }

  async function handleGenerateAndSave() {
    setGenerating(true)
    setError(null)
    try {
      const content = await electron.generateDocs(buildPayload())
      const filename = format === 'html' ? 'api-docs.html' : 'api-docs.md'
      await electron.saveResults(content, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  async function handlePreview() {
    setGenerating(true)
    setError(null)
    try {
      const content = await electron.generateDocs(buildPayload())
      setPreview(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl w-[680px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800 flex-shrink-0">
          <span className="text-sm font-semibold text-white">Generate API Documentation</span>
          <button
            onClick={onClose}
            className="text-surface-600 hover:text-white transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
          {/* Collection selector */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-600 mb-2">
              Collections to include
            </p>
            {collectionList.length === 0 ? (
              <p className="text-xs text-surface-600">No collections loaded.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {collectionList.map(c => (
                  <label key={c.data.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.data.id)}
                      onChange={() => toggleCollection(c.data.id)}
                      className="accent-blue-500"
                    />
                    <span className="text-sm text-surface-300">{c.data.name}</span>
                    <span className="text-xs text-surface-600">
                      ({Object.keys(c.data.requests).length} requests)
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Format selector */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-600 mb-2">Format</p>
            <div className="flex gap-3">
              {(['markdown', 'html'] as const).map(f => (
                <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    value={f}
                    checked={format === f}
                    onChange={() => { setFormat(f); setPreview(null) }}
                    className="accent-blue-500"
                  />
                  <span className={`text-sm ${format === f ? 'text-white' : 'text-surface-600'}`}>
                    {f === 'markdown' ? 'Markdown (.md)' : 'HTML (.html)'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Preview */}
          {preview !== null && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-600">Preview</p>
                <button
                  onClick={() => setPreview(null)}
                  className="text-[10px] text-surface-600 hover:text-surface-400 transition-colors"
                >
                  Close preview
                </button>
              </div>
              <div className="rounded overflow-hidden border border-surface-700" style={{ height: 280 }}>
                <CodeMirror
                  value={preview}
                  height="280px"
                  theme={oneDark}
                  extensions={[]}
                  editable={false}
                  basicSetup={{ lineNumbers: true, foldGutter: false }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePreview}
            disabled={generating || selectedIds.size === 0}
            className="px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors"
          >
            {generating ? 'Generating…' : 'Preview'}
          </button>
          <button
            onClick={handleGenerateAndSave}
            disabled={generating || selectedIds.size === 0}
            className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors"
          >
            {generating ? 'Generating…' : 'Generate & Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
