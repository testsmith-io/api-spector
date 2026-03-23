import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { ApiRequest, WsMessage } from '../../../../shared/types'

const { electron } = window as any

interface Props {
  request: ApiRequest
}

// Format timestamp as HH:MM:SS.mmm
function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function WebSocketPanel({ request }: Props) {
  const wsConnections    = useStore(s => s.wsConnections)
  const setWsStatus      = useStore(s => s.setWsStatus)
  const addWsMessage     = useStore(s => s.addWsMessage)
  const clearWsMessages  = useStore(s => s.clearWsMessages)

  const conn = wsConnections[request.id] ?? { status: 'disconnected', messages: [] }
  const isConnected = conn.status === 'connected'
  const isConnecting = conn.status === 'connecting'

  const [sendText, setSendText] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)

  // Subscribe to WS events from main process
  useEffect(() => {
    electron.onWsMessage(({ requestId, message }: { requestId: string; message: WsMessage }) => {
      addWsMessage(requestId, message)
    })
    electron.onWsStatus(({ requestId, status, error }: { requestId: string; status: string; error?: string }) => {
      setWsStatus(requestId, status as WsMessage['direction'] extends infer _ ? any : never, error)
    })
    return () => {
      electron.offWsEvents()
    }
  }, [])

  // Auto-scroll to latest message
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conn.messages.length])

  async function connect() {
    if (!request.url) return
    const headers: Record<string, string> = {}
    for (const h of request.headers) {
      if (h.enabled && h.key) headers[h.key] = h.value
    }
    try {
      await electron.wsConnect(request.id, request.url, headers)
    } catch (err) {
      setWsStatus(request.id, 'error', err instanceof Error ? err.message : String(err))
    }
  }

  async function disconnect() {
    await electron.wsDisconnect(request.id)
  }

  async function sendMessage() {
    const text = sendText.trim()
    if (!text || !isConnected) return
    try {
      await electron.wsSend(request.id, text)
      const msg: WsMessage = {
        id: crypto.randomUUID(),
        direction: 'sent',
        data: text,
        timestamp: Date.now(),
      }
      addWsMessage(request.id, msg)
      setSendText('')
    } catch (err) {
      setWsStatus(request.id, 'error', err instanceof Error ? err.message : String(err))
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Status badge
  const statusColors: Record<string, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-400',
    error: 'bg-red-500',
    disconnected: 'bg-surface-600',
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header / name */}
      <div className="px-4 pt-3 pb-1 flex-shrink-0">
        <span className="text-sm font-medium text-white">{request.name}</span>
      </div>

      {/* URL bar + connect/disconnect */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0">
        {/* WS badge */}
        <span className="text-xs font-bold text-cyan-400 bg-surface-800 border border-surface-700 rounded px-2 py-1.5">
          WS
        </span>

        {/* URL display (read-only here; editing is in the request URL field) */}
        <div className="flex-1 bg-surface-800 border border-surface-700 rounded px-3 py-1.5 text-sm font-mono text-surface-400 truncate">
          {request.url || <span className="text-surface-600">ws://...</span>}
        </div>

        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[conn.status] ?? 'bg-surface-600'}`} title={conn.status} />

        {isConnected || isConnecting ? (
          <button
            onClick={disconnect}
            disabled={isConnecting}
            className="px-4 py-1.5 bg-red-700 hover:bg-red-600 disabled:bg-surface-800 disabled:text-surface-600 rounded text-sm font-medium transition-colors min-w-[100px]"
          >
            {isConnecting ? 'Connecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={!request.url}
            className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-surface-800 disabled:text-surface-600 rounded text-sm font-medium transition-colors min-w-[100px]"
          >
            Connect
          </button>
        )}
      </div>

      {/* Error message */}
      {conn.status === 'error' && conn.error && (
        <div className="mx-4 mb-1 px-3 py-1.5 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-400 flex-shrink-0">
          {conn.error}
        </div>
      )}

      {/* URL edit hint */}
      <div className="px-4 mb-1 flex-shrink-0">
        <p className="text-[10px] text-surface-600">
          Edit URL and headers in the <span className="text-surface-500">Headers</span> tab above. Connect then send messages below.
        </p>
      </div>

      {/* Message log */}
      <div className="flex-1 min-h-0 mx-4 mb-2 border border-surface-800 rounded overflow-y-auto bg-surface-950 relative">
        {conn.messages.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-surface-400">
            No messages yet
          </div>
        ) : (
          <div className="p-2 flex flex-col gap-1">
            {conn.messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-2 items-start text-xs rounded px-2 py-1.5 ${
                  msg.direction === 'sent'
                    ? 'bg-blue-900/30 border border-blue-800/40'
                    : 'bg-emerald-900/20 border border-emerald-800/30'
                }`}
              >
                {/* Direction arrow */}
                <span className={`flex-shrink-0 font-mono font-bold ${msg.direction === 'sent' ? 'text-blue-400' : 'text-emerald-400'}`}>
                  {msg.direction === 'sent' ? '→' : '←'}
                </span>
                {/* Data */}
                <span className="flex-1 font-mono text-surface-300 whitespace-pre-wrap break-all">{msg.data}</span>
                {/* Timestamp */}
                <span className="flex-shrink-0 text-surface-400 font-mono text-[10px] mt-px">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Clear messages button */}
      {conn.messages.length > 0 && (
        <div className="px-4 mb-1 flex-shrink-0 flex justify-end">
          <button
            onClick={() => clearWsMessages(request.id)}
            className="text-[10px] text-surface-600 hover:text-surface-400 transition-colors"
          >
            Clear messages
          </button>
        </div>
      )}

      {/* Send area */}
      <div className="px-4 pb-3 flex-shrink-0 flex gap-2">
        <textarea
          value={sendText}
          onChange={e => setSendText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          rows={2}
          placeholder={isConnected ? 'Type a message… (Ctrl+Enter to send)' : 'Connect first to send messages'}
          className="flex-1 resize-none bg-surface-800 border border-surface-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={!isConnected || !sendText.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-800 disabled:text-surface-400 rounded text-sm font-medium transition-colors self-end"
        >
          Send
        </button>
      </div>
    </div>
  )
}
