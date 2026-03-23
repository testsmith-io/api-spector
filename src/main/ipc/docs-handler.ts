import { type IpcMain } from 'electron'
import type { Collection, ApiRequest, Folder } from '../../shared/types'

// ─── Payload types ────────────────────────────────────────────────────────────

export interface DocsPayload {
  collections: Array<{
    collection: Collection
    requests: Record<string, ApiRequest>
  }>
  format: 'html' | 'markdown'
}

// ─── Markdown generation ─────────────────────────────────────────────────────

export function escMd(s: string): string {
  return s.replace(/[|\\`*_{}[\]()#+\-.!]/g, c => `\\${c}`)
}

function requestToMarkdown(req: ApiRequest): string {
  const lines: string[] = []

  const methodLabel = req.protocol === 'websocket' ? 'WS' : req.method
  lines.push(`#### ${methodLabel} ${escMd(req.name)}`)
  lines.push('')

  if (req.description?.trim()) {
    lines.push(req.description.trim())
    lines.push('')
  }

  lines.push('**URL**')
  lines.push('```')
  lines.push(req.url || '(no url)')
  lines.push('```')
  lines.push('')

  const enabledParams = req.params.filter(p => p.enabled && p.key)
  if (enabledParams.length) {
    lines.push('**Query Parameters**')
    lines.push('')
    lines.push('| Key | Value | Description |')
    lines.push('|-----|-------|-------------|')
    for (const p of enabledParams) {
      lines.push(`| ${escMd(p.key)} | ${escMd(p.value)} | ${escMd(p.description ?? '')} |`)
    }
    lines.push('')
  }

  const enabledHeaders = req.headers.filter(h => h.enabled && h.key)
  if (enabledHeaders.length) {
    lines.push('**Headers**')
    lines.push('')
    lines.push('| Key | Value |')
    lines.push('|-----|-------|')
    for (const h of enabledHeaders) {
      lines.push(`| ${escMd(h.key)} | ${escMd(h.value)} |`)
    }
    lines.push('')
  }

  if (req.auth.type !== 'none') {
    lines.push(`**Auth**: ${req.auth.type}`)
    lines.push('')
  }

  const mode = req.body.mode
  if (mode === 'json' && req.body.json?.trim()) {
    lines.push('**Body** (JSON)')
    lines.push('```json')
    lines.push(req.body.json.trim())
    lines.push('```')
    lines.push('')
  } else if (mode === 'raw' && req.body.raw?.trim()) {
    const ct = req.body.rawContentType ?? 'text'
    lines.push(`**Body** (${ct})`)
    lines.push('```')
    lines.push(req.body.raw.trim())
    lines.push('```')
    lines.push('')
  } else if (mode === 'graphql' && req.body.graphql?.query?.trim()) {
    lines.push('**Body** (GraphQL)')
    lines.push('```graphql')
    lines.push(req.body.graphql.query.trim())
    lines.push('```')
    lines.push('')
  } else if (mode === 'soap' && req.body.soap?.envelope?.trim()) {
    lines.push('**Body** (SOAP)')
    lines.push('```xml')
    lines.push(req.body.soap.envelope.trim())
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}

function folderToMarkdown(folder: Folder, requests: Record<string, ApiRequest>, depth: number): string {
  const lines: string[] = []
  const heading = '#'.repeat(depth)

  if (folder.name !== 'root') {
    lines.push(`${heading} ${escMd(folder.name)}`)
    lines.push('')
    if (folder.description?.trim()) {
      lines.push(folder.description.trim())
      lines.push('')
    }
  }

  for (const reqId of folder.requestIds) {
    const req = requests[reqId]
    if (req) {
      lines.push(requestToMarkdown(req))
    }
  }

  for (const sub of folder.folders) {
    lines.push(folderToMarkdown(sub, requests, depth + 1))
  }

  return lines.join('\n')
}

export function generateMarkdown(payload: DocsPayload): string {
  const lines: string[] = []
  lines.push('# API Documentation')
  lines.push('')

  for (const { collection, requests } of payload.collections) {
    lines.push(`## ${escMd(collection.name)}`)
    lines.push('')
    if (collection.description?.trim()) {
      lines.push(collection.description.trim())
      lines.push('')
    }
    lines.push(folderToMarkdown(collection.rootFolder, requests, 3))
  }

  return lines.join('\n')
}

// ─── HTML generation ──────────────────────────────────────────────────────────

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399', POST: '#60a5fa', PUT: '#fbbf24', PATCH: '#fb923c',
  DELETE: '#f87171', HEAD: '#6aa3c8', OPTIONS: '#9ca3af', WS: '#22d3ee',
}

function requestToHtml(req: ApiRequest): string {
  const methodLabel = req.protocol === 'websocket' ? 'WS' : req.method
  const color = METHOD_COLORS[methodLabel] ?? '#9ca3af'
  let html = `<div class="request">`
  html += `<h4><span class="method" style="color:${color}">${escHtml(methodLabel)}</span> ${escHtml(req.name)}</h4>`

  if (req.description?.trim()) {
    html += `<p class="desc">${escHtml(req.description.trim())}</p>`
  }

  html += `<div class="label">URL</div><pre><code>${escHtml(req.url || '(no url)')}</code></pre>`

  const enabledParams = req.params.filter(p => p.enabled && p.key)
  if (enabledParams.length) {
    html += `<div class="label">Query Parameters</div><table><thead><tr><th>Key</th><th>Value</th><th>Description</th></tr></thead><tbody>`
    for (const p of enabledParams) {
      html += `<tr><td>${escHtml(p.key)}</td><td>${escHtml(p.value)}</td><td>${escHtml(p.description ?? '')}</td></tr>`
    }
    html += `</tbody></table>`
  }

  const enabledHeaders = req.headers.filter(h => h.enabled && h.key)
  if (enabledHeaders.length) {
    html += `<div class="label">Headers</div><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>`
    for (const h of enabledHeaders) {
      html += `<tr><td>${escHtml(h.key)}</td><td>${escHtml(h.value)}</td></tr>`
    }
    html += `</tbody></table>`
  }

  if (req.auth.type !== 'none') {
    html += `<div class="label">Auth</div><p class="auth-type">${escHtml(req.auth.type)}</p>`
  }

  const mode = req.body.mode
  if (mode === 'json' && req.body.json?.trim()) {
    html += `<div class="label">Body (JSON)</div><pre><code class="lang-json">${escHtml(req.body.json.trim())}</code></pre>`
  } else if (mode === 'raw' && req.body.raw?.trim()) {
    html += `<div class="label">Body (${escHtml(req.body.rawContentType ?? 'text')})</div><pre><code>${escHtml(req.body.raw.trim())}</code></pre>`
  } else if (mode === 'graphql' && req.body.graphql?.query?.trim()) {
    html += `<div class="label">Body (GraphQL)</div><pre><code>${escHtml(req.body.graphql.query.trim())}</code></pre>`
  } else if (mode === 'soap' && req.body.soap?.envelope?.trim()) {
    html += `<div class="label">Body (SOAP)</div><pre><code>${escHtml(req.body.soap.envelope.trim())}</code></pre>`
  }

  html += `</div>`
  return html
}

function folderToHtml(folder: Folder, requests: Record<string, ApiRequest>, depth: number): string {
  let html = ''
  const tag = `h${Math.min(depth, 6)}`

  if (folder.name !== 'root') {
    html += `<${tag} class="folder-heading">${escHtml(folder.name)}</${tag}>`
    if (folder.description?.trim()) {
      html += `<p class="folder-desc">${escHtml(folder.description.trim())}</p>`
    }
  }

  for (const reqId of folder.requestIds) {
    const req = requests[reqId]
    if (req) html += requestToHtml(req)
  }

  for (const sub of folder.folders) {
    html += folderToHtml(sub, requests, depth + 1)
  }

  return html
}

export function generateHtml(payload: DocsPayload): string {
  let body = ''
  for (const { collection, requests } of payload.collections) {
    body += `<section class="collection"><h2>${escHtml(collection.name)}</h2>`
    if (collection.description?.trim()) {
      body += `<p class="collection-desc">${escHtml(collection.description.trim())}</p>`
    }
    body += folderToHtml(collection.rootFolder, requests, 3)
    body += `</section>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>API Documentation</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; margin: 0; padding: 2rem; line-height: 1.6; }
  h1 { font-size: 2rem; color: #f8fafc; border-bottom: 2px solid #1e293b; padding-bottom: .5rem; }
  h2 { font-size: 1.5rem; color: #f1f5f9; margin-top: 2.5rem; border-bottom: 1px solid #1e293b; padding-bottom: .4rem; }
  h3 { font-size: 1.2rem; color: #cbd5e1; margin-top: 2rem; }
  h4 { font-size: 1rem; margin: 0 0 .5rem; display: flex; align-items: center; gap: .5rem; color: #f1f5f9; }
  .method { font-weight: 700; font-family: monospace; font-size: .85rem; }
  .collection { margin-bottom: 3rem; }
  .collection-desc, .folder-desc, .desc { color: #94a3b8; font-size: .9rem; margin: .25rem 0 1rem; }
  .request { background: #1e2433; border: 1px solid #2d3748; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
  .label { font-size: .7rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #64748b; margin: .75rem 0 .3rem; }
  pre { background: #131924; border: 1px solid #2d3748; border-radius: 6px; padding: .75rem 1rem; overflow-x: auto; margin: 0; }
  code { font-family: 'JetBrains Mono', 'Fira Mono', monospace; font-size: .8rem; color: #a5f3fc; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; margin: .25rem 0; }
  th { background: #131924; color: #64748b; font-weight: 600; text-align: left; padding: .4rem .6rem; border: 1px solid #2d3748; }
  td { padding: .35rem .6rem; border: 1px solid #2d3748; color: #cbd5e1; font-family: monospace; font-size: .8rem; }
  .auth-type { background: #1e2433; border: 1px solid #2d3748; border-radius: 4px; display: inline-block; padding: .2rem .6rem; font-size: .8rem; color: #a5f3fc; margin: 0; }
  .folder-heading { color: #94a3b8; font-size: 1.05rem; }
</style>
</head>
<body>
<h1>API Documentation</h1>
${body}
</body>
</html>`
}

// ─── IPC handler ─────────────────────────────────────────────────────────────

export function registerDocsHandlers(ipc: IpcMain): void {
  ipc.handle('docs:generate', async (_event, payload: DocsPayload): Promise<string> => {
    if (payload.format === 'html') {
      return generateHtml(payload)
    }
    return generateMarkdown(payload)
  })
}
