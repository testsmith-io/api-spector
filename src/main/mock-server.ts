import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { randomUUID } from 'crypto'
import type { MockServer, MockRoute, MockHit } from '../shared/types'

const running     = new Map<string, Server>()
const liveRoutes  = new Map<string, MockRoute[]>()  // mutable — survives route edits

let hitCallback: ((hit: MockHit) => void) | null = null

export function setHitCallback(cb: ((hit: MockHit) => void) | null) {
  hitCallback = cb
}

/** Call this whenever routes are saved while the server is running. */
export function updateMockRoutes(id: string, routes: MockRoute[]): void {
  liveRoutes.set(id, routes)
}

function matchPath(pattern: string, urlPath: string): boolean {
  const regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[^/]+/g, '[^/]+')
  const regex = new RegExp('^' + regexStr + '/?$')
  return regex.test(urlPath.split('?')[0])
}

function findRoute(routes: MockRoute[], method: string, urlPath: string): MockRoute | null {
  const path = urlPath.split('?')[0]
  return (
    routes.find(r => r.method === method && matchPath(r.path, path)) ??
    routes.find(r => r.method === 'ANY'  && matchPath(r.path, path)) ??
    null
  )
}

export async function startMock(server: MockServer): Promise<void> {
  if (running.has(server.id)) await stopMock(server.id)

  liveRoutes.set(server.id, server.routes)

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reqStart = Date.now()
    const method   = (req.method ?? 'GET').toUpperCase()
    const urlPath  = req.url ?? '/'

    // Silently ignore browser-generated noise
    if (urlPath === '/favicon.ico') {
      res.writeHead(204); res.end(); return
    }
    // Always read from liveRoutes so edits apply without restart
    const routes   = liveRoutes.get(server.id) ?? []
    const route    = findRoute(routes, method, urlPath)

    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No matching mock route', method, path: urlPath }))
      hitCallback?.({
        id: randomUUID(), serverId: server.id, timestamp: reqStart,
        method, path: urlPath, matchedRouteId: null,
        status: 404, durationMs: Date.now() - reqStart,
      })
      return
    }

    const respond = () => {
      const headers = { 'Content-Type': 'application/json', ...route.headers }
      res.writeHead(route.statusCode, headers)
      res.end(route.body)
      hitCallback?.({
        id: randomUUID(), serverId: server.id, timestamp: reqStart,
        method, path: urlPath, matchedRouteId: route.id,
        status: route.statusCode, durationMs: Date.now() - reqStart,
      })
    }

    if (route.delay && route.delay > 0) { setTimeout(respond, route.delay) } else { respond() }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(server.port, '127.0.0.1', resolve)
  })

  running.set(server.id, httpServer)
}

export async function stopMock(id: string): Promise<void> {
  const srv = running.get(id)
  if (!srv) return
  await new Promise<void>((resolve, reject) =>
    srv.close(err => (err ? reject(err) : resolve()))
  )
  running.delete(id)
  liveRoutes.delete(id)
}

export function isRunning(id: string): boolean {
  return running.has(id)
}

export function getRunningIds(): string[] {
  return [...running.keys()]
}

export async function stopAll(): Promise<void> {
  await Promise.all([...running.keys()].map(stopMock))
}
