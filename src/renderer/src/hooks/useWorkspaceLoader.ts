import { useStore } from '../store'
import type { Collection, Workspace } from '../../../shared/types'

const { electron } = window as any

export function useWorkspaceLoader() {
  const loadCollection   = useStore(s => s.loadCollection)
  const loadEnvironment  = useStore(s => s.loadEnvironment)
  const loadMock         = useStore(s => s.loadMock)
  const setActiveCollection = useStore(s => s.setActiveCollection)

  async function applyWorkspace(ws: Workspace, path: string) {
    // Reset to a clean slate before loading the new workspace
    useStore.setState({
      workspace: ws,
      workspacePath: path,
      collections: {},
      environments: {},
      mocks: {},
      tabs: [],
      activeTabId: null,
      activeMockId: null,
    })

    for (const colPath of ws.collections) {
      try {
        const col: Collection = await electron.loadCollection(colPath)
        loadCollection(colPath, col)
      } catch { /* ignore missing files */ }
    }

    for (const envPath of ws.environments) {
      try {
        const env = await electron.loadEnvironment(envPath)
        loadEnvironment(envPath, env)
      } catch { /* ignore */ }
    }

    for (const relPath of (ws.mocks ?? [])) {
      try {
        const mockData = await electron.loadMock(relPath)
        loadMock(relPath, mockData)
      } catch { /* ignore */ }
    }

    if (ws.collections.length > 0) {
      try {
        const firstCol: Collection = await electron.loadCollection(ws.collections[0])
        setActiveCollection(firstCol.id)
      } catch { /* ignore */ }
    }
  }

  return { applyWorkspace }
}
