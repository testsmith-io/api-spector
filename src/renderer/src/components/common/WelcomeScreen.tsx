import { useWorkspaceLoader } from '../../hooks/useWorkspaceLoader'

const { electron } = window as any

export function WelcomeScreen() {
  const { applyWorkspace } = useWorkspaceLoader()

  async function openWorkspace() {
    const result = await electron.openWorkspace()
    if (!result) return
    await applyWorkspace(result.workspace, result.workspacePath)
  }

  async function newWorkspace() {
    const result = await electron.newWorkspace()
    if (!result) return
    await applyWorkspace(result.workspace, result.workspacePath)
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center p-8">
      <div>
        <h1 className="text-2xl font-semibold text-white mb-2">api Spector</h1>
        <p className="text-surface-400 text-sm max-w-sm">
          Local-first API testing with Robot Framework &amp; Playwright code generation.
          Secrets stay on your machine.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-64">
        <button
          onClick={openWorkspace}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
        >
          Open Workspace
        </button>
        <button
          onClick={newWorkspace}
          className="px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded text-sm font-medium transition-colors"
        >
          New Workspace
        </button>
      </div>

      <p className="text-surface-400 text-xs max-w-xs">
        A workspace is a <code className="text-surface-500">.spector</code> file.
        Commit it and your collections to Git — secrets are stored in your OS keychain, never on disk.
      </p>
    </div>
  )
}
