import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useStore } from '../../store'
import { MethodBadge } from './MethodBadge'

export function CommandPalette() {
  const open               = useStore(s => s.commandPaletteOpen)
  const setOpen            = useStore(s => s.setCommandPaletteOpen)
  const collections        = useStore(s => s.collections)
  const openInTab          = useStore(s => s.openInTab)

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Build flat list of all requests with collection context
  const allRequests = useMemo(() => {
    const results: { requestId: string; collectionId: string; name: string; url: string; method: string; collectionName: string }[] = []
    for (const { data: col } of Object.values(collections)) {
      for (const req of Object.values(col.requests)) {
        results.push({
          requestId: req.id,
          collectionId: col.id,
          name: req.name,
          url: req.url,
          method: req.method,
          collectionName: col.name,
        })
      }
    }
    return results
  }, [collections])

  const filtered = useMemo(() => {
    if (!query.trim()) return allRequests.slice(0, 30)
    const q = query.toLowerCase()
    return allRequests.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q) ||
      r.method.toLowerCase().includes(q)
    ).slice(0, 30)
  }, [allRequests, query])

  // Clamp activeIdx when filtered list changes
  useEffect(() => {
    setActiveIdx(prev => Math.min(prev, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIdx]
      if (item) { openInTab(item.requestId, item.collectionId); setOpen(false) }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] bg-surface-900 border border-surface-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-800">
          <svg className="w-4 h-4 text-surface-600 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search requests by name, URL, or method..."
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder-surface-600"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd className="text-[10px] text-surface-600 bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-surface-600">
              No requests match "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.requestId}
                onClick={() => { openInTab(item.requestId, item.collectionId); setOpen(false) }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  idx === activeIdx ? 'bg-surface-800' : 'hover:bg-surface-800/50'
                }`}
              >
                <MethodBadge method={item.method} size="xs" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{item.name}</div>
                  <div className="text-[11px] text-surface-600 font-mono truncate">{item.url || '(no URL)'}</div>
                </div>
                <span className="text-[10px] text-surface-600 shrink-0 truncate max-w-[120px]">
                  {item.collectionName}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-surface-800 flex items-center gap-3 text-[10px] text-surface-600">
            <span><kbd className="bg-surface-800 border border-surface-700 rounded px-1">↑↓</kbd> navigate</span>
            <span><kbd className="bg-surface-800 border border-surface-700 rounded px-1">↵</kbd> open</span>
          </div>
        )}
      </div>
    </div>
  )
}
