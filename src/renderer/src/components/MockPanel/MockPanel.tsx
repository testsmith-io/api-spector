import React from 'react'
import { useStore } from '../../store'

const { electron } = window as any

export function MockPanel() {
  const mocks         = useStore(s => s.mocks)
  const activeMockId  = useStore(s => s.activeMockId)
  const setActiveMock = useStore(s => s.setActiveMockId)
  const addMock       = useStore(s => s.addMock)
  const setRunning    = useStore(s => s.setMockRunning)

  const mockList = Object.values(mocks)

  async function handleAddMock() {
    addMock()
    const ws = useStore.getState().workspace
    if (ws) await electron.saveWorkspace(ws)
    const state = useStore.getState()
    const newId = state.activeMockId
    if (newId) {
      const entry = state.mocks[newId]
      await electron.saveMock(entry.relPath, entry.data)
      setActiveMock(newId)
    }
  }

  async function toggleRunning(e: React.MouseEvent, mockId: string) {
    e.stopPropagation()
    const entry = useStore.getState().mocks[mockId]
    if (!entry) return
    try {
      if (entry.running) {
        await electron.mockStop(mockId)
        setRunning(mockId, false)
      } else {
        const latest = useStore.getState().mocks[mockId].data
        await electron.saveMock(entry.relPath, latest)
        await electron.mockStart(latest)
        setRunning(mockId, true)
      }
    } catch { /* errors shown in detail panel */ }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center justify-between border-b border-surface-800 flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-surface-600">
          Mock Servers
        </span>
        <button
          onClick={handleAddMock}
          className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mockList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <p className="text-surface-400 text-xs">No mock servers yet.</p>
            <button
              onClick={handleAddMock}
              className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded text-xs transition-colors"
            >
              Create mock server
            </button>
          </div>
        ) : (
          mockList.map(entry => {
            const mock    = entry.data
            const active  = activeMockId === mock.id
            return (
              <button
                key={mock.id}
                onClick={() => setActiveMock(mock.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors border-b border-surface-800/50 group ${
                  active ? 'bg-surface-800' : 'hover:bg-surface-800/50'
                }`}
              >
                {/* Running indicator */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  entry.running ? 'bg-emerald-400' : 'bg-surface-700'
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{mock.name}</div>
                  <div className="text-[10px] text-surface-400 font-mono">
                    :{mock.port} · {mock.routes.length} route{mock.routes.length !== 1 ? 's' : ''}
                  </div>
                </div>

                <button
                  onClick={e => toggleRunning(e, mock.id)}
                  className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors ${
                    entry.running
                      ? 'text-emerald-400 hover:text-red-400'
                      : 'text-surface-400 hover:text-emerald-400 opacity-0 group-hover:opacity-100'
                  }`}
                  title={entry.running ? 'Stop' : 'Start'}
                >
                  {entry.running ? '■' : '▶'}
                </button>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
