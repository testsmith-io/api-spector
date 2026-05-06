// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { xml } from '@codemirror/lang-xml';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ApiRequest, SoapBody } from '../../../../shared/types';
import { contentTypeForSoap, withContentType } from '../../../../shared/soap';

const { electron } = window;

interface WsdlParam {
  name: string
  typeHint: string
  children?: WsdlParam[]
}

interface WsdlOperation {
  name: string
  binding?: string
  soapAction?: string
  soapVersion: '1.1' | '1.2'
  endpoint?: string
  inputTemplate: string
  params?: WsdlParam[]
}

interface WsdlEndpoint {
  binding: string
  address: string
  soapVersion: '1.1' | '1.2'
}

interface Props {
  request: ApiRequest
  onChange: (p: Partial<ApiRequest>) => void
}

// ─── Param tree (read-only) ──────────────────────────────────────────────────

function ParamTree({ params, depth = 0 }: { params: WsdlParam[]; depth?: number }) {
  if (params.length === 0) {
    return <p className="text-[10px] text-surface-600 italic">No parameters declared in WSDL.</p>;
  }
  return (
    <ul className={depth === 0 ? 'flex flex-col gap-0.5' : 'flex flex-col gap-0.5 ml-4 border-l border-surface-800 pl-3 mt-1'}>
      {params.map((p, i) => (
        <li key={`${p.name}-${i}`} className="text-[11px] font-mono">
          <span className="text-surface-200">{p.name}</span>
          <span className="text-surface-600">: </span>
          <span className="text-blue-400">{p.typeHint}</span>
          {p.children && p.children.length > 0 && <ParamTree params={p.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

// ─── Main editor ─────────────────────────────────────────────────────────────

export function SoapEditor({ request, onChange }: Props) {
  const soap: SoapBody = request.body.soap ?? { wsdlUrl: '', envelope: '' };

  const [operations, setOperations] = useState<WsdlOperation[]>([]);
  const [endpoints, setEndpoints]   = useState<WsdlEndpoint[]>([]);
  const [targetNs, setTargetNs]     = useState<string>('');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching]     = useState(false);
  // Show the XML envelope by default — for SOAP, the wire body IS the
  // important detail. Users still get the toggle to collapse it if they want
  // to focus on the operation list.
  const [showXml, setShowXml]       = useState(true);

  // After a panel/tab switch the component remounts and `operations` is empty
  // again, even though the request still has a saved WSDL URL + envelope.
  // Re-fetch silently so the operations sidebar reappears, but don't touch the
  // envelope — the user's edits are sacred.
  useEffect(() => {
    const url = soap.wsdlUrl?.trim();
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await electron.wsdlFetch(url);
        if (cancelled) return;
        setOperations(result.operations as WsdlOperation[]);
        setEndpoints(result.endpoints);
        setTargetNs(result.targetNamespace);
      } catch {
        // Best-effort. If the WSDL is offline we keep showing the saved
        // envelope below so the user can still edit/send.
      }
    })();
    return () => { cancelled = true; };
    // Re-run when the user opens a different SOAP request, not on every
    // keystroke in the URL field — they click Fetch for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  function updateSoap(patch: Partial<SoapBody>) {
    onChange({ body: { ...request.body, soap: { ...soap, ...patch } } });
  }

  /** Apply an operation to the whole request. The endpoint is the WSDL's
   *  `<soap:address>` — always authoritative for SOAP, so we overwrite the
   *  request URL. Method, Content-Type, SOAPAction header, and envelope are
   *  all wired in one shot so Send works without manual setup. */
  function applyOperation(op: WsdlOperation) {
    const headers = withContentType(request.headers ?? [], contentTypeForSoap(op.soapVersion));
    onChange({
      method: 'POST',
      headers,
      ...(op.endpoint ? { url: op.endpoint } : {}),
      body: {
        ...request.body,
        soap: {
          ...soap,
          operationName: op.name,
          soapAction:    op.soapAction ?? '',
          envelope:      op.inputTemplate,
        },
      },
    });
  }

  async function fetchWsdl() {
    if (!soap.wsdlUrl.trim()) return;
    setFetching(true);
    setFetchError(null);
    try {
      const result = await electron.wsdlFetch(soap.wsdlUrl.trim());
      setOperations(result.operations as WsdlOperation[]);
      setEndpoints(result.endpoints);
      setTargetNs(result.targetNamespace);
      if (result.operations.length > 0) {
        applyOperation(result.operations[0] as WsdlOperation);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  function selectOperation(op: WsdlOperation) {
    applyOperation(op);
  }

  const selected = operations.find(o => o.name === soap.operationName) ?? operations[0];
  const primaryEndpoint = endpoints[0]?.address;
  const versions = Array.from(new Set(operations.map(o => o.soapVersion))).sort();

  // What we have available, regardless of whether operations are loaded.
  const hasSavedSoap = Boolean(soap.envelope?.trim() || soap.operationName || soap.wsdlUrl?.trim());
  const showFullUi   = operations.length > 0;
  const showFallback = !showFullUi && hasSavedSoap;
  const showEmpty    = !showFullUi && !showFallback;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* ── WSDL URL row ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 items-center">
        <label className="text-[10px] uppercase tracking-wider text-surface-500 font-medium whitespace-nowrap">
          WSDL
        </label>
        <input
          value={soap.wsdlUrl}
          onChange={e => updateSoap({ wsdlUrl: e.target.value })}
          placeholder="https://example.com/service?WSDL"
          onKeyDown={e => { if (e.key === 'Enter' && !fetching) fetchWsdl(); }}
          className="flex-1 text-xs bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-surface-600 font-mono"
        />
        <button
          onClick={fetchWsdl}
          disabled={fetching || !soap.wsdlUrl.trim()}
          className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-surface-800 disabled:text-surface-600 rounded transition-colors whitespace-nowrap"
        >
          {fetching ? 'Fetching…' : operations.length > 0 ? 'Refresh' : 'Fetch WSDL'}
        </button>
      </div>

      {fetchError && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded px-2.5 py-1.5">
          {fetchError}
        </p>
      )}

      {/* ── Service summary card ──────────────────────────────────────────── */}
      {operations.length > 0 && (
        <div className="bg-surface-900/40 border border-surface-800 rounded-md px-3 py-2 text-[11px] flex flex-col gap-1">
          <div className="flex items-center gap-2 text-surface-500">
            <span className="uppercase tracking-wider text-[9px] font-semibold text-surface-600 w-20 shrink-0">Endpoint</span>
            <code className="text-surface-200 font-mono truncate">{primaryEndpoint ?? '(not declared)'}</code>
          </div>
          {targetNs && (
            <div className="flex items-center gap-2 text-surface-500">
              <span className="uppercase tracking-wider text-[9px] font-semibold text-surface-600 w-20 shrink-0">Namespace</span>
              <code className="text-surface-200 font-mono truncate">{targetNs}</code>
            </div>
          )}
          <div className="flex items-center gap-2 text-surface-500">
            <span className="uppercase tracking-wider text-[9px] font-semibold text-surface-600 w-20 shrink-0">Operations</span>
            <span className="text-surface-300">
              {operations.length}
              <span className="text-surface-600"> · SOAP {versions.join(', ')}</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Operations + detail panel (only after a successful fetch) ─────── */}
      {showFullUi && (
        <div className="flex gap-3 min-h-0 flex-1">
          {/* Operations list */}
          <div className="w-44 shrink-0 flex flex-col bg-surface-900/40 border border-surface-800 rounded-md overflow-hidden">
            <div className="px-2.5 py-1.5 text-[9px] uppercase tracking-wider font-semibold text-surface-600 border-b border-surface-800">
              Operations
            </div>
            <div className="overflow-y-auto flex-1">
              {operations.map(op => {
                const active = selected && op.name === selected.name && op.soapVersion === selected.soapVersion;
                return (
                  <button
                    key={`${op.binding ?? ''}:${op.name}:${op.soapVersion}`}
                    onClick={() => selectOperation(op)}
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] border-b border-surface-800/50 transition-colors ${
                      active ? 'bg-blue-900/30 text-blue-300' : 'text-surface-300 hover:bg-surface-800/60'
                    }`}
                  >
                    <div className="font-mono truncate">{op.name}</div>
                    {op.soapVersion === '1.2' && (
                      <div className="text-[9px] text-surface-600 uppercase">SOAP 1.2</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {selected && (
              <>
                {/* Operation header */}
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-white font-mono">{selected.name}</h3>
                  <span className="text-[10px] uppercase tracking-wider text-surface-500">
                    SOAP {selected.soapVersion}
                  </span>
                </div>
                {selected.soapAction && (
                  <p className="text-[11px] text-surface-500 font-mono truncate">
                    SOAPAction: <span className="text-surface-300">{selected.soapAction}</span>
                  </p>
                )}

                {/* Inputs */}
                <div className="bg-surface-900/40 border border-surface-800 rounded-md px-3 py-2">
                  <div className="text-[9px] uppercase tracking-wider font-semibold text-surface-600 mb-1.5">
                    Inputs
                  </div>
                  <ParamTree params={selected.params ?? []} />
                </div>

                {/* Envelope toggle + editor */}
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-surface-600">
                    Envelope
                  </span>
                  <button
                    onClick={() => setShowXml(v => !v)}
                    className="text-[10px] text-surface-500 hover:text-surface-300 transition-colors"
                  >
                    {showXml ? '▾ Hide XML' : '▸ Edit XML'}
                  </button>
                </div>
                {!showXml && (
                  <p className="text-[10px] text-surface-600 leading-relaxed">
                    Envelope auto-generated from the operation's input parameters.
                    Method (POST), endpoint URL, and Content-Type are managed for you. Click <em>Edit XML</em> to tweak.
                  </p>
                )}
                {showXml && (
                  <div className="rounded overflow-hidden border border-surface-700 flex-1 min-h-0">
                    <CodeMirror
                      value={soap.envelope ?? ''}
                      height="100%"
                      theme={oneDark}
                      extensions={[xml()]}
                      onChange={val => updateSoap({ envelope: val })}
                      basicSetup={{ lineNumbers: true, foldGutter: true }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Fallback: WSDL not loaded (yet), but request already has data.
            Show the saved envelope so a tab switch or offline WSDL doesn't
            wipe the user's work. */}
      {showFallback && (
        <div className="flex flex-col gap-2 flex-1 min-h-0">
          <div className="bg-surface-900/40 border border-surface-800 rounded-md px-3 py-2 text-[11px] flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {soap.operationName && (
                <div className="font-mono text-surface-200 truncate">{soap.operationName}</div>
              )}
              {soap.soapAction && (
                <div className="text-[10px] text-surface-500 truncate">SOAPAction: {soap.soapAction}</div>
              )}
              {!soap.operationName && !soap.soapAction && (
                <div className="text-[10px] text-surface-500">
                  {soap.wsdlUrl?.trim()
                    ? 'WSDL not loaded — the saved envelope below is still sent on Send.'
                    : 'No WSDL — hand-crafted SOAP envelope.'}
                </div>
              )}
            </div>
            {soap.wsdlUrl?.trim() && (
              <button
                onClick={fetchWsdl}
                disabled={fetching}
                className="px-2.5 py-1 text-[11px] bg-surface-800 hover:bg-surface-700 disabled:opacity-50 rounded transition-colors whitespace-nowrap"
              >
                {fetching ? 'Loading…' : 'Reload WSDL'}
              </button>
            )}
          </div>
          <div className="rounded overflow-hidden border border-surface-700 flex-1 min-h-0">
            <CodeMirror
              value={soap.envelope ?? ''}
              height="100%"
              theme={oneDark}
              extensions={[xml()]}
              onChange={val => updateSoap({ envelope: val })}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        </div>
      )}

      {/* ── True empty state: nothing fetched, nothing saved. */}
      {showEmpty && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 border border-dashed border-surface-800 rounded-md py-8 px-4">
          <p className="text-xs text-surface-400">Paste a WSDL URL above and click <em>Fetch WSDL</em>.</p>
          <p className="text-[10px] text-surface-600 max-w-sm">
            The endpoint, SOAP version, Content-Type header, and per-operation envelope are
            derived from the WSDL — you only pick the operation and fill the parameters.
          </p>
        </div>
      )}
    </div>
  );
}
